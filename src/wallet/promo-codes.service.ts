import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  promoCodes,
  promoRedemptions,
  type PromoCodeRow,
} from '../database/schema/promo-codes';
import { IdempotencyService } from './idempotency.service';
import { LedgerService, type BalanceSnapshot } from './ledger.service';
import type { Tx } from './wallet.types';

export interface PromoRedeemResult {
  code: string;
  kind: PromoCodeRow['kind'];
  sweepsCents: number;
  balance: BalanceSnapshot;
}

@Injectable()
export class PromoCodesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  async redeem(
    userId: string,
    rawCode: string,
    idempotencyKey: string,
  ): Promise<PromoRedeemResult> {
    const code = this.normalizeCode(rawCode);
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
      throw new BadRequestException('Invalid promo code format');
    }

    const { result } = await this.idempotency.execute<PromoRedeemResult>({
      scope: 'promo_redeem',
      key: idempotencyKey,
      userId,
      requestPayload: { code },
      handler: (tx) => this.redeemWithin(tx, userId, code, idempotencyKey),
    });
    return result;
  }

  private async redeemWithin(
    tx: Tx,
    userId: string,
    code: string,
    idempotencyKey: string,
  ): Promise<PromoRedeemResult> {
    const [promo] = await tx
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.code, code))
      .for('update')
      .limit(1);

    if (!promo) {
      throw new NotFoundException('Promo code not found');
    }

    const now = new Date();
    if (!promo.active) throw new BadRequestException('Promo code is inactive');
    if (promo.startsAt && promo.startsAt > now) {
      throw new BadRequestException('Promo code is not yet active');
    }
    if (promo.expiresAt && promo.expiresAt <= now) {
      throw new BadRequestException('Promo code has expired');
    }
    if (
      promo.maxRedemptions !== null &&
      promo.redemptionCount >= promo.maxRedemptions
    ) {
      throw new ConflictException(
        'Promo code has reached its redemption limit',
      );
    }

    const [existingRedemption] = await tx
      .select()
      .from(promoRedemptions)
      .where(
        and(
          eq(promoRedemptions.userId, userId),
          eq(promoRedemptions.promoId, promo.id),
        ),
      )
      .limit(1);

    if (existingRedemption) {
      throw new ConflictException('Promo code already redeemed');
    }

    try {
      await tx.insert(promoRedemptions).values({
        id: randomUUID(),
        promoId: promo.id,
        userId,
        sweepsCents: promo.sweepsCents,
        idempotencyKey,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Promo code already redeemed');
      }
      throw err;
    }

    await tx
      .update(promoCodes)
      .set({
        redemptionCount: sql`${promoCodes.redemptionCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(promoCodes.id, promo.id));

    let balance: BalanceSnapshot = {
      sweepsCashableCents: 0,
      sweepsLockedCents: 0,
      sweepsTotalCents: 0,
    };

    if (promo.kind === 'bonus_sweeps_locked' && promo.sweepsCents > 0) {
      const { snapshot } = await this.ledger.post(
        {
          userId,
          kind: 'promo_redeem',
          currency: 'sweeps_locked',
          amount: promo.sweepsCents,
          referenceType: 'promo',
          referenceId: String(promo.id),
          idempotencyKey: `promo:${promo.id}`,
          memo: `Promo ${code}`,
        },
        tx,
      );
      balance = snapshot;
    } else {
      balance = await this.fetchBalance(tx, userId);
    }

    return {
      code: promo.code,
      kind: promo.kind,
      sweepsCents: promo.sweepsCents,
      balance,
    };
  }

  private async fetchBalance(tx: Tx, userId: string): Promise<BalanceSnapshot> {
    const out = await this.ledger.getBalance(userId);
    void tx;
    return out;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
