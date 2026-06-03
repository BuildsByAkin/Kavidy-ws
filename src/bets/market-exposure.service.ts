import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { betEntries } from '../database/schema/bet-entries';
import { betPicks } from '../database/schema/bet-picks';
import { markets } from '../database/schema/markets';

export const EXPOSURE_SKEW_THRESHOLD = 0.80;
export const EXPOSURE_MIN_STAKE_CENTS = 5_000;
export const EXPOSURE_MAX_SIDE_PAYOUT_CENTS = 1_000_000;

export interface MarketExposure {
  marketId: string;
  yesPayoutCents: number;
  noPayoutCents: number;
  totalStakeCents: number;
  skew: number;
  dominantDirection: 'yes' | 'no' | null;
}

@Injectable()
export class MarketExposureService {
  private readonly logger = new Logger(MarketExposureService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async checkAndCloseIfNeeded(marketId: string): Promise<void> {
    const exposure = await this.computeExposure(marketId);

    if (!exposure) return;

    const { yesPayoutCents, noPayoutCents, totalStakeCents, skew, dominantDirection } = exposure;
    const dominantSidePayout = Math.max(yesPayoutCents, noPayoutCents);

    if (totalStakeCents < EXPOSURE_MIN_STAKE_CENTS) return;

    const skewTripped = skew >= EXPOSURE_SKEW_THRESHOLD;
    const payoutCapTripped = dominantSidePayout >= EXPOSURE_MAX_SIDE_PAYOUT_CENTS;

    if (!skewTripped && !payoutCapTripped) return;

    const reason = payoutCapTripped
      ? `payout cap exceeded (${dominantSidePayout} cents on ${dominantDirection} side)`
      : `skew threshold exceeded (${(skew * 100).toFixed(1)}% on ${dominantDirection} side)`;

    const result = await this.db
      .update(markets)
      .set({ status: 'closed', updatedAt: new Date() })
      .where(and(eq(markets.id, marketId), eq(markets.status, 'open')))
      .returning({ id: markets.id });

    if (result.length > 0) {
      this.logger.warn(
        `Market ${marketId} auto-closed: ${reason} | yes=${yesPayoutCents} no=${noPayoutCents} totalStake=${totalStakeCents}`,
      );
    }
  }

  async computeExposure(marketId: string): Promise<MarketExposure | null> {
    const picks = await this.db
      .select({
        direction: betPicks.direction,
        potentialPayoutCents: betEntries.potentialPayoutCents,
        stakeAmountCents: betEntries.stakeAmountCents,
      })
      .from(betPicks)
      .innerJoin(betEntries, eq(betPicks.entryId, betEntries.id))
      .where(
        and(
          eq(betPicks.marketId, marketId),
          eq(betPicks.status, 'pending'),
          eq(betEntries.status, 'pending'),
        ),
      );

    if (picks.length === 0) return null;

    let yesPayoutCents = 0;
    let noPayoutCents = 0;
    let totalStakeCents = 0;

    for (const pick of picks) {
      totalStakeCents += pick.stakeAmountCents;
      if (pick.direction === 'yes') {
        yesPayoutCents += pick.potentialPayoutCents;
      } else {
        noPayoutCents += pick.potentialPayoutCents;
      }
    }

    const totalPayoutCents = yesPayoutCents + noPayoutCents;
    const dominantSidePayout = Math.max(yesPayoutCents, noPayoutCents);
    const skew = totalPayoutCents > 0 ? dominantSidePayout / totalPayoutCents : 0;
    const dominantDirection: 'yes' | 'no' | null =
      yesPayoutCents === noPayoutCents
        ? null
        : yesPayoutCents > noPayoutCents
          ? 'yes'
          : 'no';

    return {
      marketId,
      yesPayoutCents,
      noPayoutCents,
      totalStakeCents,
      skew,
      dominantDirection,
    };
  }
}
