import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { betEntries, type BetEntryRow } from '../database/schema/bet-entries';
import { betPicks, type BetPickRow } from '../database/schema/bet-picks';
import type { Tx } from '../wallet/wallet.types';
import { LedgerService } from '../wallet/ledger.service';
import {
  BET_CURRENCY,
  MIN_EFFECTIVE_PICKS_FOR_PAYOUT,
  computePotentialPayout,
  getMultiplierX100,
} from './bets.constants';

const TERMINAL_MARKET_STATUSES = new Set([
  'resolved_yes',
  'resolved_no',
  'void',
  'abandoned',
]);

@Injectable()
export class BetsSettlementService {
  private readonly logger = new Logger(BetsSettlementService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
  ) {}

  async settlePicksForMarket(
    marketId: string,
    marketFinalStatus: string,
  ): Promise<void> {
    if (!TERMINAL_MARKET_STATUSES.has(marketFinalStatus)) {
      this.logger.warn(
        `settlePicksForMarket called with non-terminal status '${marketFinalStatus}' for market ${marketId} — skipping`,
      );
      return;
    }

    const pendingPicks = await this.db
      .select()
      .from(betPicks)
      .where(
        and(
          eq(betPicks.marketId, marketId),
          eq(betPicks.status, 'pending'),
        ),
      );

    if (pendingPicks.length === 0) {
      this.logger.debug(`No pending picks for market ${marketId}`);
      return;
    }

    this.logger.log(
      `Settling ${pendingPicks.length} pick(s) for market ${marketId} (status=${marketFinalStatus})`,
    );

    const entryIds = [...new Set(pendingPicks.map((p) => p.entryId))];

    for (const entryId of entryIds) {
      try {
        await this.db.transaction((tx) =>
          this.settleEntry(tx, entryId, marketId, marketFinalStatus),
        );
      } catch (err) {
        this.logger.error(
          `Failed to settle entry ${entryId} for market ${marketId}: ${String(err)}`,
        );
      }
    }
  }

  private async settleEntry(
    tx: Tx,
    entryId: string,
    marketId: string,
    marketFinalStatus: string,
  ): Promise<void> {
    const [entry] = await tx
      .select()
      .from(betEntries)
      .where(eq(betEntries.id, entryId))
      .for('update')
      .limit(1);

    if (!entry || entry.status !== 'pending') {
      return;
    }

    const allPicks = await tx
      .select()
      .from(betPicks)
      .where(eq(betPicks.entryId, entryId));

    const now = new Date();

    const pendingForMarket = allPicks.filter(
      (p) => p.marketId === marketId && p.status === 'pending',
    );

    if (pendingForMarket.length > 0) {
      for (const pick of pendingForMarket) {
        const outcome = computePickOutcome(pick.direction, marketFinalStatus);
        await tx
          .update(betPicks)
          .set({
            status: outcome,
            marketResolvedStatus: marketFinalStatus,
            resolvedAt: now,
          })
          .where(and(eq(betPicks.id, pick.id), eq(betPicks.status, 'pending')));
      }
    }

    const projectedPicks: BetPickRow[] = allPicks.map((pick) => {
      if (pick.marketId === marketId && pick.status === 'pending') {
        return {
          ...pick,
          status: computePickOutcome(pick.direction, marketFinalStatus),
          marketResolvedStatus: marketFinalStatus,
          resolvedAt: now,
        };
      }
      return pick;
    });

    const hasLost = projectedPicks.some((p) => p.status === 'lost');
    const hasPending = projectedPicks.some((p) => p.status === 'pending');

    if (hasLost) {
      await this.markEntryLost(tx, entry, now);
      return;
    }

    if (hasPending) {
      return;
    }

    const effectivePicks = projectedPicks.filter((p) => p.status !== 'void');

    if (effectivePicks.length < MIN_EFFECTIVE_PICKS_FOR_PAYOUT) {
      await this.markEntryVoid(tx, entry, now);
      return;
    }

    await this.markEntryWon(tx, entry, effectivePicks.length, now);
  }

  private async markEntryLost(
    tx: Tx,
    entry: BetEntryRow,
    now: Date,
  ): Promise<void> {
    await tx
      .update(betEntries)
      .set({ status: 'lost', settledAt: now, updatedAt: now })
      .where(eq(betEntries.id, entry.id));

    this.logger.log(`Entry ${entry.id} settled as lost`);
  }

  private async markEntryVoid(
    tx: Tx,
    entry: BetEntryRow,
    now: Date,
  ): Promise<void> {
    await tx
      .update(betEntries)
      .set({ status: 'void', settledAt: now, updatedAt: now })
      .where(eq(betEntries.id, entry.id));

    await this.ledger.post(
      {
        userId: entry.userId,
        kind: 'bet_refund',
        currency: BET_CURRENCY,
        amount: entry.stakeAmountCents,
        referenceType: 'bet_entry',
        referenceId: entry.id,
        idempotencyKey: `bet_refund:${entry.id}`,
        memo: 'Entry voided — insufficient effective picks after market voids',
      },
      tx,
    );

    this.logger.log(`Entry ${entry.id} voided and stake refunded`);
  }

  private async markEntryWon(
    tx: Tx,
    entry: BetEntryRow,
    effectivePickCount: number,
    now: Date,
  ): Promise<void> {
    const adjustedMultiplierX100 = getMultiplierX100(effectivePickCount);
    const actualPayoutCents = computePotentialPayout(
      entry.stakeAmountCents,
      adjustedMultiplierX100,
    );

    await tx
      .update(betEntries)
      .set({
        status: 'won',
        actualPayoutCents,
        settledAt: now,
        updatedAt: now,
      })
      .where(eq(betEntries.id, entry.id));

    await this.ledger.post(
      {
        userId: entry.userId,
        kind: 'bet_payout',
        currency: BET_CURRENCY,
        amount: actualPayoutCents,
        referenceType: 'bet_entry',
        referenceId: entry.id,
        idempotencyKey: `bet_payout:${entry.id}`,
        memo: `Entry won — ${effectivePickCount} of ${entry.pickCount} picks`,
        metadata: {
          effective_pick_count: effectivePickCount,
          adjusted_multiplier_x100: adjustedMultiplierX100,
        },
      },
      tx,
    );

    this.logger.log(
      `Entry ${entry.id} won — payout ${actualPayoutCents} cents (${effectivePickCount} effective picks)`,
    );
  }
}

function computePickOutcome(
  direction: 'yes' | 'no',
  marketFinalStatus: string,
): 'won' | 'lost' | 'void' {
  if (
    marketFinalStatus === 'void' ||
    marketFinalStatus === 'abandoned'
  ) {
    return 'void';
  }
  if (marketFinalStatus === 'resolved_yes') {
    return direction === 'yes' ? 'won' : 'lost';
  }
  if (marketFinalStatus === 'resolved_no') {
    return direction === 'no' ? 'won' : 'lost';
  }
  throw new Error(`Unexpected market final status: ${marketFinalStatus}`);
}
