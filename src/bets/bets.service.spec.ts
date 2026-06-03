import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { BetEntryRow } from '../database/schema/bet-entries';
import type { BetPickRow } from '../database/schema/bet-picks';
import type { MarketRow } from '../database/schema/markets';
import type { LedgerService } from '../wallet/ledger.service';
import { BetsService } from './bets.service';
import type { PlaceEntryInput } from './bets.service';
import {
  getMultiplierX100,
  computePotentialPayout,
  formatMultiplier,
} from './bets.constants';
import type { MarketExposureService } from './market-exposure.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const PICK_ID_1 = '33333333-3333-4333-8333-333333333333';
const PICK_ID_2 = '44444444-4444-4444-8444-444444444444';
const PICK_ID_3 = '55555555-5555-4555-8555-555555555555';
const MARKET_ID_1 = 'streamer:plays_slots:abc1';
const MARKET_ID_2 = 'streamer:hits_jackpot:abc2';
const MARKET_ID_3 = 'streamer:goes_bust:abc3';

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
    idempotencyKey: 'test-idem-key-001',
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
    marketQuestion: `Will something happen on ${marketId}?`,
    marketResolvedStatus: null,
    resolvedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

function makeMarketRow(id: string, status = 'open'): MarketRow {
  return {
    id,
    creatorId: 'streamer',
    creatorDisplayName: 'Streamer',
    creatorPrimaryPlatform: 'kick',
    question: `Will something happen on ${id}?`,
    kind: 'generic',
    status: status as MarketRow['status'],
    confidenceLevel: 'medium',
    opensAt: new Date('2026-06-01T00:00:00Z'),
    resolvesAt: new Date('2026-06-02T00:00:00Z'),
    generatedAt: new Date('2026-06-01T00:00:00Z'),
    resolvedAt: null,
    evidence: [],
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
  };
}

function makeLedger(): jest.Mocked<LedgerService> {
  return {
    post: jest.fn().mockResolvedValue({
      snapshot: { sweepsCashableCents: 5000, sweepsLockedCents: 0, sweepsTotalCents: 5000 },
      balanceAfter: 5000,
      ledgerId: 'ledger-id-001',
    }),
    ensureBalanceRow: jest.fn().mockResolvedValue(undefined),
    getBalance: jest.fn(),
    withTransaction: jest.fn(),
  } as unknown as jest.Mocked<LedgerService>;
}

function makeDb(opts: {
  existingEntry?: BetEntryRow | null;
  marketRows?: MarketRow[];
  insertedEntry?: BetEntryRow;
  insertedPicks?: BetPickRow[];
  entryRows?: BetEntryRow[];
  allPicks?: BetPickRow[];
}) {
  const { existingEntry = null, marketRows = [], insertedEntry, insertedPicks = [], entryRows = [], allPicks = [] } = opts;

  const tx: any = {
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    for: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
  };

  if (insertedEntry) {
    tx.returning
      .mockResolvedValueOnce([insertedEntry])
      .mockResolvedValueOnce(insertedPicks);
  }

  const selectChain: any = {
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
  };

  let selectCallCount = 0;
  selectChain.from.mockImplementation(() => {
    return selectChain;
  });
  selectChain.where.mockImplementation(() => {
    return selectChain;
  });
  selectChain.limit.mockImplementation(() => {
    selectCallCount++;
    if (selectCallCount === 1) return Promise.resolve(existingEntry ? [existingEntry] : []);
    if (selectCallCount === 2) return Promise.resolve(marketRows);
    return Promise.resolve([]);
  });
  selectChain.orderBy.mockReturnValue(Promise.resolve(entryRows));

  const db: any = {
    select: jest.fn().mockReturnValue(selectChain),
    transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(tx)),
  };

  return { db, tx };
}

function makeExposure(): jest.Mocked<MarketExposureService> {
  return {
    checkAndCloseIfNeeded: jest.fn().mockResolvedValue(undefined),
    computeExposure: jest.fn().mockResolvedValue(null),
  } as unknown as jest.Mocked<MarketExposureService>;
}

function makePlaceInput(overrides: Partial<PlaceEntryInput> = {}): PlaceEntryInput {
  return {
    picks: [
      { marketId: MARKET_ID_1, direction: 'yes' },
      { marketId: MARKET_ID_2, direction: 'no' },
      { marketId: MARKET_ID_3, direction: 'yes' },
    ],
    stakeAmountCents: 500,
    idempotencyKey: 'test-idem-key-001',
    ...overrides,
  };
}

describe('BetsService', () => {
  describe('placeEntry', () => {
    it('throws BadRequestException when duplicate market IDs are in picks', async () => {
      const { db } = makeDb({});
      const ledger = makeLedger();
      const svc = new BetsService(db, ledger, makeExposure());

      await expect(
        svc.placeEntry(USER_ID, {
          ...makePlaceInput(),
          picks: [
            { marketId: MARKET_ID_1, direction: 'yes' },
            { marketId: MARKET_ID_1, direction: 'no' },
            { marketId: MARKET_ID_2, direction: 'yes' },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws UnprocessableEntityException when fewer than 3 picks are provided', async () => {
      const { db } = makeDb({});
      const ledger = makeLedger();
      const svc = new BetsService(db, ledger, makeExposure());

      await expect(
        svc.placeEntry(USER_ID, {
          ...makePlaceInput(),
          picks: [
            { marketId: MARKET_ID_1, direction: 'yes' },
            { marketId: MARKET_ID_2, direction: 'no' },
          ],
        }),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('returns replayed entry when idempotency key already exists', async () => {
      const existingEntry = makeEntry();
      const { db } = makeDb({ existingEntry });

      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([existingEntry]),
          }),
        }),
      });
      db.select.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            makePick(PICK_ID_1, MARKET_ID_1),
            makePick(PICK_ID_2, MARKET_ID_2),
            makePick(PICK_ID_3, MARKET_ID_3),
          ]),
        }),
      });

      const ledger = makeLedger();
      const svc = new BetsService(db, ledger, makeExposure());

      const result = await svc.placeEntry(USER_ID, makePlaceInput());
      expect(result.entry.id).toBe(ENTRY_ID);
      expect(ledger.post).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when a market is not found', async () => {
      const db: any = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
        transaction: jest.fn(),
      };

      db.select
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([makeMarketRow(MARKET_ID_1)]),
          }),
        });

      const ledger = makeLedger();
      const svc = new BetsService(db, ledger, makeExposure());

      await expect(svc.placeEntry(USER_ID, makePlaceInput())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when a market is not open', async () => {
      const db: any = {
        select: jest
          .fn()
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([
                makeMarketRow(MARKET_ID_1, 'resolved_yes'),
                makeMarketRow(MARKET_ID_2, 'open'),
                makeMarketRow(MARKET_ID_3, 'open'),
              ]),
            }),
          }),
        transaction: jest.fn(),
      };

      const ledger = makeLedger();
      const svc = new BetsService(db, ledger, makeExposure());

      await expect(svc.placeEntry(USER_ID, makePlaceInput())).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('bets.constants', () => {
    it('getMultiplierX100 returns correct values', () => {
      expect(getMultiplierX100(3)).toBe(500);
      expect(getMultiplierX100(4)).toBe(1000);
      expect(getMultiplierX100(5)).toBe(2000);
      expect(getMultiplierX100(6)).toBe(4000);
    });

    it('computePotentialPayout floors the result correctly', () => {
      expect(computePotentialPayout(100, 500)).toBe(500);
      expect(computePotentialPayout(333, 500)).toBe(1665);
      expect(computePotentialPayout(100, 1000)).toBe(1000);
    });

    it('getMultiplierX100 throws for unsupported pick count', () => {
      expect(() => getMultiplierX100(7)).toThrow();
      expect(() => getMultiplierX100(1)).toThrow();
    });

    it('formatMultiplier returns human-readable string', () => {
      expect(formatMultiplier(500)).toBe('5.00x');
      expect(formatMultiplier(1000)).toBe('10.00x');
      expect(formatMultiplier(300)).toBe('3.00x');
    });
  });

  describe('listEntries', () => {
    it('returns an empty page when user has no entries', async () => {
      const db: any = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      };
      const svc = new BetsService(db, makeLedger(), makeExposure());
      const page = await svc.listEntries({ userId: USER_ID, limit: 20 });
      expect(page.items).toHaveLength(0);
      expect(page.nextCursor).toBeNull();
    });

    it('throws BadRequestException on malformed cursor', async () => {
      const db: any = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
      };
      const svc = new BetsService(db, makeLedger(), makeExposure());
      await expect(
        svc.listEntries({ userId: USER_ID, limit: 20, cursor: 'not-valid!!!' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findEntryById', () => {
    it('returns null when entry does not belong to user', async () => {
      const db: any = {
        select: jest.fn().mockReturnValue({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        }),
      };
      const svc = new BetsService(db, makeLedger(), makeExposure());
      const result = await svc.findEntryById(ENTRY_ID, USER_ID);
      expect(result).toBeNull();
    });

    it('returns entry with picks when found', async () => {
      const entry = makeEntry();
      const picks = [makePick(PICK_ID_1, MARKET_ID_1)];

      const db: any = {
        select: jest
          .fn()
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([entry]),
              }),
            }),
          })
          .mockReturnValueOnce({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue(picks),
            }),
          }),
      };
      const svc = new BetsService(db, makeLedger(), makeExposure());
      const result = await svc.findEntryById(ENTRY_ID, USER_ID);
      expect(result).not.toBeNull();
      expect(result!.entry.id).toBe(ENTRY_ID);
      expect(result!.picks).toHaveLength(1);
    });
  });
});
