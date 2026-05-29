import { randomUUID } from 'crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { balances } from '../database/schema/balances';
import { walletLedger } from '../database/schema/wallet-ledger';
import type { Tx, WalletCurrency } from './wallet.types';

export type LedgerKind =
  | 'deposit_purchase'
  | 'deposit_first_purchase_bonus'
  | 'promo_redeem'
  | 'daily_bonus'
  | 'bet_stake'
  | 'bet_payout'
  | 'bet_refund'
  | 'unlock_sweeps'
  | 'cashout_request'
  | 'cashout_reversal'
  | 'admin_adjustment';

export interface PostLedgerInput {
  userId: string;
  kind: LedgerKind;
  currency: WalletCurrency;
  amount: number;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey?: string | null;
  memo?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface BalanceSnapshot {
  sweepsCashableCents: number;
  sweepsLockedCents: number;
  sweepsTotalCents: number;
}

@Injectable()
export class LedgerService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async ensureBalanceRow(userId: string, tx?: Tx): Promise<void> {
    const exec = tx ?? this.db;
    await exec
      .insert(balances)
      .values({ userId })
      .onConflictDoNothing({ target: balances.userId });
  }

  async getBalance(userId: string): Promise<BalanceSnapshot> {
    const [row] = await this.db
      .select()
      .from(balances)
      .where(eq(balances.userId, userId))
      .limit(1);

    if (!row) {
      return {
        sweepsCashableCents: 0,
        sweepsLockedCents: 0,
        sweepsTotalCents: 0,
      };
    }
    return toSnapshot(row);
  }

  async post(
    input: PostLedgerInput,
    tx: Tx,
  ): Promise<{
    snapshot: BalanceSnapshot;
    balanceAfter: number;
    ledgerId: string;
  }> {
    if (!Number.isInteger(input.amount) || input.amount === 0) {
      throw new UnprocessableEntityException(
        'Ledger amount must be a non-zero integer',
      );
    }

    await this.ensureBalanceRow(input.userId, tx);

    const [row] = await tx
      .select()
      .from(balances)
      .where(eq(balances.userId, input.userId))
      .for('update')
      .limit(1);

    if (!row) {
      throw new InternalServerErrorException(
        'Balance row missing after ensure',
      );
    }

    const column = columnFor(input.currency);
    const current = row[column];
    const next = current + input.amount;

    if (next < 0) {
      throw new ConflictException('Insufficient balance');
    }

    const ledgerId = randomUUID();

    try {
      await tx.insert(walletLedger).values({
        id: ledgerId,
        userId: input.userId,
        kind: input.kind,
        currency: input.currency,
        amount: input.amount,
        balanceAfter: next,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        memo: input.memo ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException(
          'Duplicate ledger entry for idempotency key',
        );
      }
      throw err;
    }

    const patch: Record<string, unknown> = {
      [column]: sql`${balances[column]} + ${input.amount}`,
      version: sql`${balances.version} + 1`,
      updatedAt: new Date(),
    };

    const [updated] = await tx
      .update(balances)
      .set(patch)
      .where(
        and(
          eq(balances.userId, input.userId),
          eq(balances.version, row.version),
        ),
      )
      .returning();

    if (!updated) {
      throw new ConflictException('Concurrent balance update conflict');
    }

    return {
      snapshot: toSnapshot(updated),
      balanceAfter: next,
      ledgerId,
    };
  }

  withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn(tx));
  }
}

function columnFor(
  currency: WalletCurrency,
): 'sweepsCashableCents' | 'sweepsLockedCents' {
  switch (currency) {
    case 'sweeps_cashable':
      return 'sweepsCashableCents';
    case 'sweeps_locked':
      return 'sweepsLockedCents';
  }
}

function toSnapshot(row: typeof balances.$inferSelect): BalanceSnapshot {
  return {
    sweepsCashableCents: row.sweepsCashableCents,
    sweepsLockedCents: row.sweepsLockedCents,
    sweepsTotalCents: row.sweepsCashableCents + row.sweepsLockedCents,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
