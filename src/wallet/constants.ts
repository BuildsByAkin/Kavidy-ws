export const DAILY_BONUS_BASE_SC_CENTS = 30;
export const DAILY_BONUS_INCREMENT_SC_CENTS = 10;
export const DAILY_BONUS_MAX_SC_CENTS = 100;

export function dailyBonusSweepsForStreak(streakDays: number): number {
  if (streakDays <= 0) return DAILY_BONUS_BASE_SC_CENTS;
  const raw =
    DAILY_BONUS_BASE_SC_CENTS +
    (streakDays - 1) * DAILY_BONUS_INCREMENT_SC_CENTS;
  return Math.min(raw, DAILY_BONUS_MAX_SC_CENTS);
}

export const FIRST_PURCHASE_BONUS_MULTIPLIER = 2;

export const DEFAULT_COIN_PACKAGES = [
  {
    code: 'spark',
    name: 'Spark',
    description: 'Light it up',
    priceCents: 499,
    sweepsCents: 500,
    bonusPercent: 0,
    badge: null,
    sortOrder: 10,
  },
  {
    code: 'rookie',
    name: 'Rookie',
    description: 'Get in the game',
    priceCents: 999,
    sweepsCents: 1_000,
    bonusPercent: 0,
    badge: null,
    sortOrder: 20,
  },
  {
    code: 'pro',
    name: 'Pro',
    description: 'Most popular',
    priceCents: 1_999,
    sweepsCents: 2_200,
    bonusPercent: 10,
    badge: 'POPULAR',
    sortOrder: 30,
  },
  {
    code: 'legend',
    name: 'Legend',
    description: 'Big swings',
    priceCents: 4_999,
    sweepsCents: 5_750,
    bonusPercent: 15,
    badge: null,
    sortOrder: 40,
  },
  {
    code: 'whale',
    name: 'Whale',
    description: 'For the high rollers',
    priceCents: 9_999,
    sweepsCents: 12_000,
    bonusPercent: 20,
    badge: 'BEST VALUE',
    sortOrder: 50,
  },
  {
    code: 'titan',
    name: 'Titan',
    description: 'Maximum firepower',
    priceCents: 19_999,
    sweepsCents: 25_000,
    bonusPercent: 25,
    badge: null,
    sortOrder: 60,
  },
] as const;
