import type { BetEntryRow } from '../database/schema/bet-entries';
import type { BetPickRow } from '../database/schema/bet-picks';
import type { LedgerService } from '../wallet/ledger.service';
import { BetsSettlementService } from './bets.settlement.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const MARKET_ID = 'streamer:plays_slots:abc1';
const OTHER_MARKET_ID = 'streamer:hits_jackpot:abc2';

function makeEntry(overrides: Partial<BetEntryRow> = {}): BetEntryRow {
  return {
    id: ENTRY_ID,
    userId: USER_ID,
    status: 'pending',
    currency: 'sweeps_cashable',
    pickCount: 3,
    stakeAmountCents: 500,
    payoutMultiplierX100: 500,
    potentialPayoutCents: 2500,
    actualPayoutCents: null,
    idempotencyKey: 'test-key',
    settledAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

function makePick(
  id: string,
  marketId: string,
  overrides: Partial<BetPickRow> = {},
): BetPickRow {
  return {
    id,
    entryId: ENTRY_ID,
    marketId,
    direction: 'yes',
    status: 'pending',
    marketQuestion: 'Will something happen?',
    marketResolvedStatus: null,
    resolvedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

function makeLedger(): jest.Mocked<LedgerService> {
  return {
    post: jest.fn().mockResolvedValue({
      snapshot: { sweepsCashableCents: 10000, sweepsLockedCents: 0, sweepsTotalCents: 10000 },
      balanceAfter: 10000,
      ledgerId: 'ledger-id',
    }),
    ensureBalanceRow: jest.fn(),
    getBalance: jest.fn(),
    withTransaction: jest.fn(),
  } as unknown as jest.Mocked<LedgerService>;
}

function makeDb(opts: {
  pendingPicks?: BetPickRow[];
  entry?: BetEntryRow | null;
  allPicksForEntry?: BetPickRow[];
}) {
  const { pendingPicks = [], entry = null, allPicksForEntry = [] } = opts;

  const tx: any = {
    select: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
  };

  tx.select
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          for: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(entry ? [entry] : []),
          }),
        }),
      }),
    })
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(allPicksForEntry),
      }),
    });

  const db: any = {
    select: jest.fn(),
    transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(tx)),
  };

  db.select
    .mockReturnValueOnce({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockResolvedValue(pendingPicks),
      }),
    });

  return { db, tx };
}

describe('BetsSettlementService', () => {
  describe('settlePicksForMarket', () => {
    it('returns immediately for non-terminal market status', async () => {
      const { db } = makeDb({});
      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'open');
      expect(db.select).not.toHaveBeenCalled();
    });

    it('is a no-op when no pending picks exist for market', async () => {
      const { db } = makeDb({ pendingPicks: [] });
      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'resolved_yes');
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('skips entry that is already settled', async () => {
      const settledEntry = makeEntry({ status: 'won' });
      const pendingPick = makePick('pick-1', MARKET_ID, { direction: 'yes' });

      const { db, tx } = makeDb({
        pendingPicks: [pendingPick],
        entry: settledEntry,
        allPicksForEntry: [pendingPick],
      });
      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'resolved_yes');
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('marks entry lost when pick direction does not match resolved_yes', async () => {
      const entry = makeEntry();
      const losingPick = makePick('pick-1', MARKET_ID, { direction: 'no' });
      const otherPick = makePick('pick-2', OTHER_MARKET_ID, { direction: 'yes' });

      const { db, tx } = makeDb({
        pendingPicks: [losingPick],
        entry,
        allPicksForEntry: [losingPick, otherPick],
      });
      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'resolved_yes');

      expect(tx.update).toHaveBeenCalled();
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('marks entry lost when pick direction does not match resolved_no', async () => {
      const entry = makeEntry();
      const losingPick = makePick('pick-1', MARKET_ID, { direction: 'yes' });

      const { db, tx } = makeDb({
        pendingPicks: [losingPick],
        entry,
        allPicksForEntry: [losingPick],
      });
      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'resolved_no');

      expect(tx.update).toHaveBeenCalled();
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('credits payout when all picks win on resolved_yes', async () => {
      const entry = makeEntry({ pickCount: 2, stakeAmountCents: 500, payoutMultiplierX100: 300 });
      const pendingPick = makePick('pick-1', MARKET_ID, { direction: 'yes' });
      const alreadyWonPick = makePick('pick-2', OTHER_MARKET_ID, {
        direction: 'yes',
        status: 'won',
        marketResolvedStatus: 'resolved_yes',
        resolvedAt: new Date('2026-06-01T12:00:00Z'),
      });

      const { db, tx } = makeDb({
        pendingPicks: [pendingPick],
        entry,
        allPicksForEntry: [pendingPick, alreadyWonPick],
      });

      tx.select
        .mockReset()
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([entry]),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([pendingPick, alreadyWonPick]),
          }),
        });

      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'resolved_yes');

      expect(ledger.post).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'bet_payout',
          userId: USER_ID,
          amount: expect.any(Number),
        }),
        tx,
      );
    });

    it('voids entry and refunds when all picks void due to abandoned market', async () => {
      const entry = makeEntry({ pickCount: 1, stakeAmountCents: 500 });
      const pick = makePick('pick-1', MARKET_ID, { direction: 'yes' });

      const { db, tx } = makeDb({
        pendingPicks: [pick],
        entry,
        allPicksForEntry: [pick],
      });

      tx.select
        .mockReset()
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              for: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([entry]),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([pick]),
          }),
        });

      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'abandoned');

      expect(ledger.post).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'bet_refund',
          userId: USER_ID,
          amount: 500,
        }),
        tx,
      );
    });

    it('does not throw if one entry settlement fails — continues processing others', async () => {
      const entry = makeEntry();
      const pick1 = makePick('pick-1', MARKET_ID, { direction: 'yes', entryId: ENTRY_ID });
      const pick2 = makePick('pick-2', MARKET_ID, { direction: 'yes', entryId: 'other-entry-id' });

      const db: any = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([pick1, pick2]),
          }),
        }),
        transaction: jest.fn()
          .mockRejectedValueOnce(new Error('DB timeout'))
          .mockResolvedValueOnce(undefined),
      };

      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await expect(
        svc.settlePicksForMarket(MARKET_ID, 'resolved_yes'),
      ).resolves.not.toThrow();

      expect(db.transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('pick outcome logic (via settlePicksForMarket)', () => {
    it('resolves pick as void for void market status', async () => {
      const entry = makeEntry();
      const pick = makePick('pick-1', MARKET_ID, { direction: 'yes' });

      const tx: any = {
        select: jest.fn()
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                for: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([entry]),
                }),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([pick]),
            }),
          }),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      };

      const db: any = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([pick]),
          }),
        }),
        transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
      };

      const ledger = makeLedger();
      const svc = new BetsSettlementService(db, ledger);

      await svc.settlePicksForMarket(MARKET_ID, 'void');

      const updateCall = tx.update.mock.calls[0];
      expect(updateCall).toBeDefined();
    });
  });
});
