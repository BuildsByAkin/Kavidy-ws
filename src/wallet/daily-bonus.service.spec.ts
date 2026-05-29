import { ConflictException } from '@nestjs/common';
import { DailyBonusService } from './daily-bonus.service';
import {
  DAILY_BONUS_BASE_SC_CENTS,
  DAILY_BONUS_INCREMENT_SC_CENTS,
} from './constants';

interface StateRow {
  userId: string;
  streakDays: number;
  lastClaimedDate: string | null;
  lastAwardedSweepsCents: number;
  totalClaims: number;
}

function makeTx(rows: StateRow[]) {
  return {
    insert() {
      return {
        values: (v: any) => ({
          onConflictDoNothing: async () => {
            if (!rows.find((r) => r.userId === v.userId)) {
              rows.push({
                userId: v.userId,
                streakDays: 0,
                lastClaimedDate: null,
                lastAwardedSweepsCents: 0,
                totalClaims: 0,
              });
            }
          },
        }),
      };
    },
    select() {
      return {
        from: () => ({
          where: () => ({
            for: () => ({ limit: async () => rows.slice(0, 1) }),
            limit: async () => rows.slice(0, 1),
          }),
        }),
      };
    },
    update() {
      return {
        set: (patch: any) => ({
          where: async () => {
            const r = rows[0];
            if (r) {
              if (patch.streakDays !== undefined)
                r.streakDays = patch.streakDays;
              if (patch.lastClaimedDate !== undefined)
                r.lastClaimedDate = patch.lastClaimedDate;
              if (patch.lastAwardedSweepsCents !== undefined)
                r.lastAwardedSweepsCents = patch.lastAwardedSweepsCents;
              if (patch.totalClaims !== undefined)
                r.totalClaims = patch.totalClaims;
            }
          },
        }),
      };
    },
  };
}

function makeDb(rows: StateRow[]) {
  return {
    select() {
      return {
        from: () => ({
          where: () => ({
            limit: async () => rows.slice(0, 1),
          }),
        }),
      };
    },
  };
}

describe('DailyBonusService', () => {
  describe('getStatus', () => {
    it('returns base reward for a new user', async () => {
      const rows: StateRow[] = [];
      const svc = new DailyBonusService(
        makeDb(rows) as any,
        {} as any,
        {} as any,
      );
      const status = await svc.getStatus(
        'u1',
        new Date('2026-01-15T12:00:00Z'),
      );
      expect(status.streakDays).toBe(0);
      expect(status.lastClaimedDate).toBeNull();
      expect(status.claimedToday).toBe(false);
      expect(status.nextRewardSweepsCents).toBe(DAILY_BONUS_BASE_SC_CENTS);
      expect(status.todayRewardSweepsCents).toBe(0);
    });

    it('reports claimedToday when last_claimed_date matches today UTC', async () => {
      const rows: StateRow[] = [
        {
          userId: 'u1',
          streakDays: 3,
          lastClaimedDate: '2026-01-15',
          lastAwardedSweepsCents:
            DAILY_BONUS_BASE_SC_CENTS + 2 * DAILY_BONUS_INCREMENT_SC_CENTS,
          totalClaims: 3,
        },
      ];
      const svc = new DailyBonusService(
        makeDb(rows) as any,
        {} as any,
        {} as any,
      );
      const status = await svc.getStatus(
        'u1',
        new Date('2026-01-15T23:59:00Z'),
      );
      expect(status.claimedToday).toBe(true);
      expect(status.streakDays).toBe(3);
      expect(status.todayRewardSweepsCents).toBe(
        DAILY_BONUS_BASE_SC_CENTS + 2 * DAILY_BONUS_INCREMENT_SC_CENTS,
      );
    });
  });

  describe('claim', () => {
    function makeService(rows: StateRow[]) {
      const ledger = {
        post: jest.fn(async () => ({
          snapshot: {
            sweepsCashableCents: 100,
            sweepsLockedCents: 0,
            sweepsTotalCents: 100,
          },
          balanceAfter: 100,
          ledgerId: 'l1',
        })),
      };
      const tx = makeTx(rows);
      const idempotency = {
        execute: jest.fn(async (opts: any) => ({
          result: await opts.handler(tx),
          replayed: false,
        })),
      };
      const svc = new DailyBonusService(
        makeDb(rows) as any,
        ledger as any,
        idempotency as any,
      );
      return { svc, ledger, idempotency, tx, rows };
    }

    it('awards base SC on first claim and sets streak to 1', async () => {
      const { svc, ledger, rows } = makeService([]);
      const out = await svc.claim(
        'u1',
        'idem-1',
        new Date('2026-01-15T12:00:00Z'),
      );
      expect(out.streakDays).toBe(1);
      expect(out.awardedSweepsCents).toBe(DAILY_BONUS_BASE_SC_CENTS);
      expect(ledger.post).toHaveBeenCalledTimes(1);
      expect((ledger.post.mock.calls[0] as any[])[0]).toMatchObject({
        currency: 'sweeps_cashable',
        kind: 'daily_bonus',
        amount: DAILY_BONUS_BASE_SC_CENTS,
        idempotencyKey: 'daily_bonus:2026-01-15',
      });
      expect(rows[0].streakDays).toBe(1);
      expect(rows[0].lastClaimedDate).toBe('2026-01-15');
    });

    it('extends streak when last claim was yesterday', async () => {
      const { svc, ledger } = makeService([
        {
          userId: 'u1',
          streakDays: 4,
          lastClaimedDate: '2026-01-14',
          lastAwardedSweepsCents: 30,
          totalClaims: 4,
        },
      ]);
      const out = await svc.claim(
        'u1',
        'idem-2',
        new Date('2026-01-15T00:01:00Z'),
      );
      expect(out.streakDays).toBe(5);
      expect(out.awardedSweepsCents).toBe(
        DAILY_BONUS_BASE_SC_CENTS + 4 * DAILY_BONUS_INCREMENT_SC_CENTS,
      );
      expect(ledger.post).toHaveBeenCalledTimes(1);
    });

    it('resets streak when a day was missed', async () => {
      const { svc } = makeService([
        {
          userId: 'u1',
          streakDays: 7,
          lastClaimedDate: '2026-01-10',
          lastAwardedSweepsCents: 80,
          totalClaims: 7,
        },
      ]);
      const out = await svc.claim(
        'u1',
        'idem-3',
        new Date('2026-01-15T00:01:00Z'),
      );
      expect(out.streakDays).toBe(1);
      expect(out.awardedSweepsCents).toBe(DAILY_BONUS_BASE_SC_CENTS);
    });

    it('rejects second claim on the same UTC day', async () => {
      const { svc } = makeService([
        {
          userId: 'u1',
          streakDays: 1,
          lastClaimedDate: '2026-01-15',
          lastAwardedSweepsCents: DAILY_BONUS_BASE_SC_CENTS,
          totalClaims: 1,
        },
      ]);
      await expect(
        svc.claim('u1', 'idem-4', new Date('2026-01-15T22:00:00Z')),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
