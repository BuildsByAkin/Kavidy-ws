import {
  DAILY_BONUS_BASE_SC_CENTS,
  DAILY_BONUS_INCREMENT_SC_CENTS,
  DAILY_BONUS_MAX_SC_CENTS,
  DEFAULT_COIN_PACKAGES,
  FIRST_PURCHASE_BONUS_MULTIPLIER,
  dailyBonusSweepsForStreak,
} from './constants';

describe('dailyBonusSweepsForStreak', () => {
  it('returns base for streak 0 or negative', () => {
    expect(dailyBonusSweepsForStreak(0)).toBe(DAILY_BONUS_BASE_SC_CENTS);
    expect(dailyBonusSweepsForStreak(-5)).toBe(DAILY_BONUS_BASE_SC_CENTS);
  });

  it('returns base on day 1', () => {
    expect(dailyBonusSweepsForStreak(1)).toBe(DAILY_BONUS_BASE_SC_CENTS);
  });

  it('increments by DAILY_BONUS_INCREMENT_SC_CENTS each day', () => {
    expect(dailyBonusSweepsForStreak(2)).toBe(
      DAILY_BONUS_BASE_SC_CENTS + DAILY_BONUS_INCREMENT_SC_CENTS,
    );
    expect(dailyBonusSweepsForStreak(5)).toBe(
      DAILY_BONUS_BASE_SC_CENTS + 4 * DAILY_BONUS_INCREMENT_SC_CENTS,
    );
  });

  it('caps at DAILY_BONUS_MAX_SC_CENTS', () => {
    expect(dailyBonusSweepsForStreak(999)).toBe(DAILY_BONUS_MAX_SC_CENTS);
  });
});

describe('DEFAULT_COIN_PACKAGES', () => {
  it('uses integer-cents and unique codes', () => {
    const codes = new Set<string>();
    for (const pkg of DEFAULT_COIN_PACKAGES) {
      expect(Number.isInteger(pkg.priceCents)).toBe(true);
      expect(Number.isInteger(pkg.sweepsCents)).toBe(true);
      expect(pkg.priceCents).toBeGreaterThan(0);
      expect(pkg.sweepsCents).toBeGreaterThan(0);
      expect(codes.has(pkg.code)).toBe(false);
      codes.add(pkg.code);
    }
  });

  it('has the six frontend packages at expected prices', () => {
    const byCode = Object.fromEntries(
      DEFAULT_COIN_PACKAGES.map((p) => [p.code, p]),
    );
    expect(byCode.spark.priceCents).toBe(499);
    expect(byCode.rookie.priceCents).toBe(999);
    expect(byCode.pro.priceCents).toBe(1999);
    expect(byCode.legend.priceCents).toBe(4999);
    expect(byCode.whale.priceCents).toBe(9999);
    expect(byCode.titan.priceCents).toBe(19999);
  });
});

describe('FIRST_PURCHASE_BONUS_MULTIPLIER', () => {
  it('is 2', () => {
    expect(FIRST_PURCHASE_BONUS_MULTIPLIER).toBe(2);
  });
});
