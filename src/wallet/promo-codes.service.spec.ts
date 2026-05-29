import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PromoCodesService } from './promo-codes.service';

interface PromoRow {
  id: number;
  code: string;
  kind: 'bonus_sweeps_locked';
  sweepsCents: number;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  redemptionCount: number;
}

interface RedemptionRow {
  userId: string;
  promoId: number;
}

function makeTx(promos: PromoRow[], redemptions: RedemptionRow[]) {
  let lastWhereTarget: 'promo' | 'redemption' = 'promo';
  return {
    insert(_table: any) {
      return {
        values: async (v: any) => {
          if ('promoId' in v) {
            if (
              redemptions.find(
                (r) => r.userId === v.userId && r.promoId === v.promoId,
              )
            ) {
              const err: any = new Error('duplicate');
              err.code = '23505';
              throw err;
            }
            redemptions.push({ userId: v.userId, promoId: v.promoId });
          }
        },
      };
    },
    select() {
      return {
        from: (table: any) => {
          const name = String(table?.[Symbol.for('drizzle:Name')] ?? '');
          lastWhereTarget = name.includes('redemption')
            ? 'redemption'
            : 'promo';
          const getter = () =>
            lastWhereTarget === 'promo'
              ? promos.slice(0, 1)
              : redemptions.filter(() => false);
          return {
            where: () => ({
              for: () => ({ limit: async () => getter() }),
              limit: async () => getter(),
            }),
          };
        },
      };
    },
    update() {
      return {
        set: () => ({
          where: async () => {
            if (promos[0]) promos[0].redemptionCount += 1;
          },
        }),
      };
    },
  };
}

function makeService(promos: PromoRow[], redemptions: RedemptionRow[]) {
  const tx = makeTx(promos, redemptions);
  const ledger = {
    post: jest.fn(async () => ({
      snapshot: {
        sweepsCashableCents: 0,
        sweepsLockedCents: promos[0]?.sweepsCents ?? 0,
        sweepsTotalCents: promos[0]?.sweepsCents ?? 0,
      },
      balanceAfter: promos[0]?.sweepsCents ?? 0,
      ledgerId: 'l1',
    })),
    getBalance: jest.fn(async () => ({
      sweepsCashableCents: 0,
      sweepsLockedCents: 0,
      sweepsTotalCents: 0,
    })),
  };
  const idempotency = {
    execute: jest.fn(async (opts: any) => ({
      result: await opts.handler(tx),
      replayed: false,
    })),
  };
  const svc = new PromoCodesService(
    {} as any,
    ledger as any,
    idempotency as any,
  );
  return { svc, ledger, idempotency };
}

describe('PromoCodesService', () => {
  describe('normalizeCode', () => {
    it('uppercases and trims', () => {
      const svc = new PromoCodesService({} as any, {} as any, {} as any);
      expect(svc.normalizeCode('  welcome10  ')).toBe('WELCOME10');
    });
  });

  it('rejects invalid format', async () => {
    const { svc } = makeService([], []);
    await expect(svc.redeem('u1', '$$', 'k1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws NotFound when promo is missing', async () => {
    const { svc } = makeService([], []);
    await expect(svc.redeem('u1', 'NOPE123', 'k1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws BadRequest when promo is inactive', async () => {
    const { svc } = makeService(
      [
        {
          id: 1,
          code: 'OFFLINE',
          kind: 'bonus_sweeps_locked',
          sweepsCents: 500,
          active: false,
          startsAt: null,
          expiresAt: null,
          maxRedemptions: null,
          redemptionCount: 0,
        },
      ],
      [],
    );
    await expect(svc.redeem('u1', 'OFFLINE', 'k1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws BadRequest when promo is expired', async () => {
    const { svc } = makeService(
      [
        {
          id: 1,
          code: 'EXP',
          kind: 'bonus_sweeps_locked',
          sweepsCents: 500,
          active: true,
          startsAt: null,
          expiresAt: new Date('2000-01-01'),
          maxRedemptions: null,
          redemptionCount: 0,
        },
      ],
      [],
    );
    await expect(svc.redeem('u1', 'EXP', 'k1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('throws Conflict when redemption cap reached', async () => {
    const { svc } = makeService(
      [
        {
          id: 1,
          code: 'CAP',
          kind: 'bonus_sweeps_locked',
          sweepsCents: 500,
          active: true,
          startsAt: null,
          expiresAt: null,
          maxRedemptions: 10,
          redemptionCount: 10,
        },
      ],
      [],
    );
    await expect(svc.redeem('u1', 'CAP', 'k1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('credits sweeps_locked on a valid bonus_sweeps_locked promo', async () => {
    const { svc, ledger } = makeService(
      [
        {
          id: 7,
          code: 'WELCOME10',
          kind: 'bonus_sweeps_locked',
          sweepsCents: 1000,
          active: true,
          startsAt: null,
          expiresAt: null,
          maxRedemptions: null,
          redemptionCount: 0,
        },
      ],
      [],
    );
    const out = await svc.redeem('u1', 'welcome10', 'k1');
    expect(out.kind).toBe('bonus_sweeps_locked');
    expect(out.sweepsCents).toBe(1000);
    expect(ledger.post).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'sweeps_locked',
        amount: 1000,
        kind: 'promo_redeem',
        idempotencyKey: 'promo:7',
      }),
      expect.anything(),
    );
  });
});
