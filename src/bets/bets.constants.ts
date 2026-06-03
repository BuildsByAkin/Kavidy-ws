export const PAYOUT_MULTIPLIERS: Readonly<Record<number, number>> = {
  2: 300,
  3: 500,
  4: 1000,
  5: 2000,
  6: 4000,
} as const;

export const MIN_PICKS = 3;
export const MAX_PICKS = 6;
export const MIN_STAKE_CENTS = 100;
export const MAX_STAKE_CENTS = 10_000;
export const MIN_EFFECTIVE_PICKS_FOR_PAYOUT = 2;
export const BET_CURRENCY = 'sweeps_cashable' as const;

export function getMultiplierX100(effectivePickCount: number): number {
  const m = (PAYOUT_MULTIPLIERS as Record<number, number>)[effectivePickCount];
  if (m === undefined) {
    throw new Error(`No multiplier defined for ${effectivePickCount} effective picks`);
  }
  return m;
}

export function computePotentialPayout(
  stakeAmountCents: number,
  multiplierX100: number,
): number {
  return Math.floor((stakeAmountCents * multiplierX100) / 100);
}

export function formatMultiplier(multiplierX100: number): string {
  return `${(multiplierX100 / 100).toFixed(2)}x`;
}
