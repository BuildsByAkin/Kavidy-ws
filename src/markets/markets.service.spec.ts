import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { MarketRow } from '../database/schema/markets';
import type { BetsSettlementService } from '../bets/bets.settlement.service';
import type { MarketsEventsService } from './markets-events.service';
import type { UpsertMarketInput } from './markets.service';
import { MarketsService } from './markets.service';

function makeEventsSvc() {
  return { emit: jest.fn(), events$: undefined as any } as unknown as MarketsEventsService;
}

function makeSettlementSvc() {
  return {
    settlePicksForMarket: jest.fn().mockResolvedValue(undefined),
  } as unknown as BetsSettlementService;
}

const OPENS_AT = '2026-06-03T18:00:00Z';
const RESOLVES_AT = '2026-06-04T18:00:00Z';
const GENERATED_AT = '2026-06-03T17:58:00Z';

function makeInput(
  overrides: Partial<UpsertMarketInput> = {},
): UpsertMarketInput {
  return {
    id: 'asmongold:reacts_patch_notes:4a9f',
    creator_id: 'asmongold',
    creator_display_name: 'Asmongold',
    creator_primary_platform: 'twitch',
    question: 'Will Asmongold react to the new WoW patch today?',
    kind: 'reacts_patch_notes',
    status: 'open',
    confidence_level: 'medium',
    opens_at: OPENS_AT,
    resolves_at: RESOLVES_AT,
    generated_at: GENERATED_AT,
    resolved_at: null,
    evidence: [
      {
        platform: 'twitch',
        summary: 'live on twitch — World of Warcraft (22,400 viewers)',
        source_url: 'https://www.twitch.tv/asmongold',
        observed_at: GENERATED_AT,
      },
    ],
    ...overrides,
  };
}

function makeRow(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    id: 'asmongold:reacts_patch_notes:4a9f',
    creatorId: 'asmongold',
    creatorDisplayName: 'Asmongold',
    creatorPrimaryPlatform: 'twitch',
    question: 'Will Asmongold react to the new WoW patch today?',
    kind: 'reacts_patch_notes',
    status: 'open',
    confidenceLevel: 'medium',
    opensAt: new Date(OPENS_AT),
    resolvesAt: new Date(RESOLVES_AT),
    generatedAt: new Date(GENERATED_AT),
    resolvedAt: null,
    evidence: [],
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

function makeDb(opts: {
  existing?: MarketRow | null;
  existingMany?: Array<{ id: string; status: MarketRow['status'] }>;
  upsertReturns?: MarketRow;
  listRows?: MarketRow[];
}) {
  const returning = jest
    .fn()
    .mockResolvedValue(opts.upsertReturns ? [opts.upsertReturns] : []);

  const onConflictDoUpdate = jest.fn().mockReturnValue({ returning });

  const values = jest.fn().mockReturnValue({ onConflictDoUpdate });

  const insert = jest.fn().mockReturnValue({ values });

  const limitFn = jest.fn().mockImplementation((n: number) => {
    if (opts.listRows !== undefined) {
      return Promise.resolve(opts.listRows.slice(0, n));
    }
    if (opts.existing !== undefined) {
      return Promise.resolve(opts.existing ? [opts.existing] : []);
    }
    return Promise.resolve([]);
  });

  const orderBy = jest.fn().mockReturnValue({ limit: limitFn });
  const where = jest.fn().mockReturnValue({ orderBy, limit: limitFn });
  const from = jest.fn().mockReturnValue({ where, orderBy, limit: limitFn });
  const select = jest.fn().mockReturnValue({ from });

  const db: any = { insert, select, transaction: jest.fn() };
  return { db, insert, select, onConflictDoUpdate, returning };
}

function makeBulkDb(existingRows: Array<{ id: string; status: MarketRow['status'] }>, returnedRows: MarketRow[]) {
  const selectFn = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockResolvedValue(existingRows),
    }),
  });

  const returning = jest.fn().mockResolvedValue(returnedRows);
  const onConflictDoUpdate = jest.fn().mockReturnValue({ returning });
  const values = jest.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = jest.fn().mockReturnValue({ values });

  return { db: { select: selectFn, insert } as any };
}

describe('MarketsService', () => {
  describe('upsert', () => {
    it('inserts a new market and returns the row', async () => {
      const row = makeRow();
      const { db } = makeDb({ existing: null, upsertReturns: row });
      const evts = makeEventsSvc();
      const svc = new MarketsService(db, evts, makeSettlementSvc());

      const result = await svc.upsert(makeInput());
      expect(result.id).toBe(row.id);
      expect(result.status).toBe('open');
    });

    it('emits a market.changed event after a successful upsert', async () => {
      const row = makeRow();
      const { db } = makeDb({ existing: null, upsertReturns: row });
      const evts = makeEventsSvc();
      const svc = new MarketsService(db, evts, makeSettlementSvc());

      await svc.upsert(makeInput());
      expect(evts.emit).toHaveBeenCalledTimes(1);
      expect(evts.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'market.changed', data: expect.objectContaining({ id: row.id }) }),
      );
    });

    it('updates an existing market that is not in terminal status', async () => {
      const existing = makeRow({ status: 'open' });
      const updated = makeRow({ status: 'resolved_yes', resolvedAt: new Date() });
      const { db } = makeDb({ existing, upsertReturns: updated });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const result = await svc.upsert(
        makeInput({ status: 'resolved_yes', resolved_at: new Date().toISOString() }),
      );
      expect(result.status).toBe('resolved_yes');
    });

    it('throws ConflictException when market is in resolved_yes status', async () => {
      const existing = makeRow({ status: 'resolved_yes' });
      const { db } = makeDb({ existing });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      await expect(svc.upsert(makeInput({ status: 'open' }))).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when market is in resolved_no status', async () => {
      const existing = makeRow({ status: 'resolved_no' });
      const { db } = makeDb({ existing });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      await expect(svc.upsert(makeInput({ status: 'open' }))).rejects.toThrow(
        ConflictException,
      );
    });

    it('does not emit when upsert throws', async () => {
      const existing = makeRow({ status: 'resolved_yes' });
      const { db } = makeDb({ existing });
      const evts = makeEventsSvc();
      const svc = new MarketsService(db, evts, makeSettlementSvc());

      await expect(svc.upsert(makeInput({ status: 'open' }))).rejects.toThrow();
      expect(evts.emit).not.toHaveBeenCalled();
    });

    it('allows upsert when existing status is void (soft terminal)', async () => {
      const existing = makeRow({ status: 'void' });
      const reopened = makeRow({ status: 'open' });
      const { db } = makeDb({ existing, upsertReturns: reopened });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const result = await svc.upsert(makeInput({ status: 'open' }));
      expect(result.status).toBe('open');
    });

    it('allows upsert when existing status is abandoned (soft terminal)', async () => {
      const existing = makeRow({ status: 'abandoned' });
      const reopened = makeRow({ status: 'open' });
      const { db } = makeDb({ existing, upsertReturns: reopened });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const result = await svc.upsert(makeInput({ status: 'open' }));
      expect(result.status).toBe('open');
    });

    it('triggers pick settlement when market transitions to resolved_yes', async () => {
      const row = makeRow({ status: 'resolved_yes', resolvedAt: new Date() });
      const { db } = makeDb({ existing: null, upsertReturns: row });
      const settlement = makeSettlementSvc();
      const svc = new MarketsService(db, makeEventsSvc(), settlement);

      await svc.upsert(makeInput({ status: 'resolved_yes', resolved_at: new Date().toISOString() }));
      expect(settlement.settlePicksForMarket).toHaveBeenCalledWith(row.id, 'resolved_yes');
    });

    it('triggers pick settlement when market transitions to resolved_no', async () => {
      const row = makeRow({ status: 'resolved_no', resolvedAt: new Date() });
      const { db } = makeDb({ existing: null, upsertReturns: row });
      const settlement = makeSettlementSvc();
      const svc = new MarketsService(db, makeEventsSvc(), settlement);

      await svc.upsert(makeInput({ status: 'resolved_no', resolved_at: new Date().toISOString() }));
      expect(settlement.settlePicksForMarket).toHaveBeenCalledWith(row.id, 'resolved_no');
    });

    it('does not trigger settlement for non-terminal status', async () => {
      const row = makeRow({ status: 'open' });
      const { db } = makeDb({ existing: null, upsertReturns: row });
      const settlement = makeSettlementSvc();
      const svc = new MarketsService(db, makeEventsSvc(), settlement);

      await svc.upsert(makeInput({ status: 'open' }));
      expect(settlement.settlePicksForMarket).not.toHaveBeenCalled();
    });

    it('does not throw if settlement fails — still returns the market row', async () => {
      const row = makeRow({ status: 'resolved_yes', resolvedAt: new Date() });
      const { db } = makeDb({ existing: null, upsertReturns: row });
      const settlement = makeSettlementSvc();
      (settlement.settlePicksForMarket as jest.Mock).mockRejectedValue(new Error('DB error'));
      const svc = new MarketsService(db, makeEventsSvc(), settlement);

      const result = await svc.upsert(makeInput({ status: 'resolved_yes', resolved_at: new Date().toISOString() }));
      expect(result.id).toBe(row.id);
    });
  });

  describe('upsertBulk', () => {
    it('skips markets in terminal status and processes the rest', async () => {
      const terminalRow = { id: 'market:a', status: 'resolved_yes' as const };
      const openRow = { id: 'market:b', status: 'open' as const };
      const processedRow = makeRow({ id: 'market:b' });
      const { db } = makeBulkDb([terminalRow, openRow], [processedRow]);
      const evts = makeEventsSvc();
      const svc = new MarketsService(db, evts, makeSettlementSvc());

      const inputs = [
        makeInput({ id: 'market:a' }),
        makeInput({ id: 'market:b' }),
      ];

      const result = await svc.upsertBulk(inputs);
      expect(result.upserted).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('emits market.changed for each row returned from bulk upsert', async () => {
      const rowA = makeRow({ id: 'market:a' });
      const rowB = makeRow({ id: 'market:b' });
      const { db } = makeBulkDb([], [rowA, rowB]);
      const evts = makeEventsSvc();
      const svc = new MarketsService(db, evts, makeSettlementSvc());

      await svc.upsertBulk([makeInput({ id: 'market:a' }), makeInput({ id: 'market:b' })]);
      expect(evts.emit).toHaveBeenCalledTimes(2);
    });

    it('returns upserted=0 skipped=N when all markets are terminal', async () => {
      const selectFn = jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { id: 'market:a', status: 'resolved_yes' as const },
          ]),
        }),
      });
      const db: any = { select: selectFn, insert: jest.fn() };
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const result = await svc.upsertBulk([makeInput({ id: 'market:a' })]);
      expect(result.upserted).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });

  describe('list', () => {
    it('returns paginated markets sorted by resolves_at asc', async () => {
      const rows = [
        makeRow({ id: 'a', resolvesAt: new Date('2026-06-04T00:00:00Z') }),
        makeRow({ id: 'b', resolvesAt: new Date('2026-06-05T00:00:00Z') }),
      ];
      const { db } = makeDb({ listRows: rows });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const page = await svc.list({ limit: 10 });
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('sets nextCursor when there are more results than limit', async () => {
      const rows = [
        makeRow({ id: 'a', resolvesAt: new Date('2026-06-04T00:00:00Z') }),
        makeRow({ id: 'b', resolvesAt: new Date('2026-06-05T00:00:00Z') }),
        makeRow({ id: 'c', resolvesAt: new Date('2026-06-06T00:00:00Z') }),
      ];
      const { db } = makeDb({ listRows: rows });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const page = await svc.list({ limit: 2 });
      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
    });

    it('returns empty page when no markets match', async () => {
      const { db } = makeDb({ listRows: [] });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const page = await svc.list({ limit: 20 });
      expect(page.items).toHaveLength(0);
      expect(page.nextCursor).toBeNull();
    });

    it('throws BadRequestException on malformed cursor', async () => {
      const { db } = makeDb({ listRows: [] });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      await expect(
        svc.list({ limit: 20, cursor: 'not-valid-base64url!!!' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findById', () => {
    it('returns the market row when found', async () => {
      const row = makeRow();
      const { db } = makeDb({ existing: row });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const result = await svc.findById(row.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(row.id);
    });

    it('returns null when not found', async () => {
      const { db } = makeDb({ existing: null });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      const result = await svc.findById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('findByIdOrThrow', () => {
    it('throws NotFoundException when market does not exist', async () => {
      const { db } = makeDb({ existing: null });
      const svc = new MarketsService(db, makeEventsSvc(), makeSettlementSvc());

      await expect(svc.findByIdOrThrow('ghost')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
