import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { dailyBonusState } from '../database/schema/daily-bonus-state';
import { dailyBonusSweepsForStreak } from './constants';
import { IdempotencyService } from './idempotency.service';
import { LedgerService, type BalanceSnapshot } from './ledger.service';
import type { Tx } from './wallet.types';

export interface DailyBonusStatus {
  streakDays: number;
  lastClaimedDate: string | null;
  claimedToday: boolean;
  nextRewardSweepsCents: number;
  todayRewardSweepsCents: number;
  totalClaims: number;
}

export interface DailyBonusClaimResult {
  streakDays: number;
  awardedSweepsCents: number;
  balance: BalanceSnapshot;
}

@Injectable()
export class DailyBonusService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly idempotency: IdempotencyService,
  ) {}

  todayUtc(now: Date = new Date()): string {
    return now.toISOString().slice(0, 10);
  }

  yesterdayUtc(today: string): string {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async getStatus(
    userId: string,
    now: Date = new Date(),
  ): Promise<DailyBonusStatus> {
    const [row] = await this.db
      .select()
      .from(dailyBonusState)
      .where(eq(dailyBonusState.userId, userId))
      .limit(1);

    const today = this.todayUtc(now);
    const claimedToday = row?.lastClaimedDate === today;
    const streakDays = row?.streakDays ?? 0;

    const nextStreak = this.computeNextStreak(
      row?.lastClaimedDate ?? null,
      streakDays,
      today,
    );

    return {
      streakDays,
      lastClaimedDate: row?.lastClaimedDate ?? null,
      claimedToday,
      nextRewardSweepsCents: dailyBonusSweepsForStreak(nextStreak),
      todayRewardSweepsCents: claimedToday
        ? (row?.lastAwardedSweepsCents ?? 0)
        : 0,
      totalClaims: row?.totalClaims ?? 0,
    };
  }

  async claim(
    userId: string,
    idempotencyKey: string,
    now: Date = new Date(),
  ): Promise<DailyBonusClaimResult> {
    const today = this.todayUtc(now);

    const { result } = await this.idempotency.execute<DailyBonusClaimResult>({
      scope: 'daily_bonus',
      key: idempotencyKey,
      userId,
      requestPayload: { today },
      handler: (tx) => this.claimWithin(tx, userId, today),
    });
    return result;
  }

  private async claimWithin(
    tx: Tx,
    userId: string,
    today: string,
  ): Promise<DailyBonusClaimResult> {
    await tx
      .insert(dailyBonusState)
      .values({ userId })
      .onConflictDoNothing({ target: dailyBonusState.userId });

    const [row] = await tx
      .select()
      .from(dailyBonusState)
      .where(eq(dailyBonusState.userId, userId))
      .for('update')
      .limit(1);

    if (row?.lastClaimedDate === today) {
      throw new ConflictException('Daily bonus already claimed today');
    }

    const newStreak = this.computeNextStreak(
      row?.lastClaimedDate ?? null,
      row?.streakDays ?? 0,
      today,
    );

    const award = dailyBonusSweepsForStreak(newStreak);

    const { snapshot } = await this.ledger.post(
      {
        userId,
        kind: 'daily_bonus',
        currency: 'sweeps_cashable',
        amount: award,
        referenceType: 'daily_bonus',
        referenceId: today,
        idempotencyKey: `daily_bonus:${today}`,
        memo: `Daily bonus day ${newStreak}`,
      },
      tx,
    );

    await tx
      .update(dailyBonusState)
      .set({
        streakDays: newStreak,
        lastClaimedDate: today,
        lastAwardedSweepsCents: award,
        totalClaims: (row?.totalClaims ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(dailyBonusState.userId, userId));

    return {
      streakDays: newStreak,
      awardedSweepsCents: award,
      balance: snapshot,
    };
  }

  private computeNextStreak(
    lastClaimedDate: string | null,
    currentStreak: number,
    today: string,
  ): number {
    if (!lastClaimedDate) return 1;
    if (lastClaimedDate === today) return currentStreak;
    const yesterday = this.yesterdayUtc(today);
    if (lastClaimedDate === yesterday) return currentStreak + 1;
    return 1;
  }
}
