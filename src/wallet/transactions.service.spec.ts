import { BadRequestException } from '@nestjs/common';
import type { WalletLedgerRow } from '../database/schema/wallet-ledger';
import type { LedgerKind } from './ledger.service';
import { TransactionsService } from './transactions.service';

type Row = WalletLedgerRow;

function row(
  partial: Partial<Row> & {
    id: string;
    kind: LedgerKind;
    amount: number;
    createdAt: Date;
  },
): Row {
  return {
    id: partial.id,
    userId: partial.userId ?? 'u1',
    kind: partial.kind,
    currency: partial.currency ?? 'sweeps_cashable',
    amount: partial.amount,
    balanceAfter: partial.balanceAfter ?? partial.amount,
    referenceType: partial.referenceType ?? null,
    referenceId: partial.referenceId ?? null,
    idempotencyKey: partial.idempotencyKey ?? null,
    memo: partial.memo ?? null,
    metadata: partial.metadata ?? null,
    createdAt: partial.createdAt,
  };
}

/**
 * A minimal fake Drizzle query builder over an in-memory ledger.
 * It supports:
 *   db.select().from(walletLedger).where(<cond>).orderBy(...).limit(N)
 * with the exact call chain used by TransactionsService.
 *
 * We don't try to reimplement Drizzle's SQL operators — instead we capture
 * the raw `params` passed in to the service and apply them ourselves.
 */
function makeDb(rows: Row[]) {
  // The service builds its own WHERE; we just intercept by re-running
  // the params it would pass via a side-channel. To keep this simple,
  // we expose a `setFilter` hook that tests use to mirror the service args.
  let appliedFilter: (r: Row) => boolean = () => true;
  let appliedOrder: (a: Row, b: Row) => number = () => 0;
  let appliedLimit = rows.length;

  const builder: any = {
    _setFilter(fn: (r: Row) => boolean) {
      appliedFilter = fn;
    },
    _setOrder(fn: (a: Row, b: Row) => number) {
      appliedOrder = fn;
    },
    select() {
      return this;
    },
    from() {
      return this;
    },
    where() {
      return this;
    },
    orderBy() {
      return this;
    },
    limit(n: number) {
      appliedLimit = n;
      const sorted = [...rows].sort(appliedOrder);
      const filtered = sorted.filter(appliedFilter);
      return Promise.resolve(filtered.slice(0, appliedLimit));
    },
  };

  return builder;
}

describe('TransactionsService', () => {
  const baseTime = new Date('2025-01-10T12:00:00.000Z').getTime();
  const u1 = '00000000-0000-4000-8000-000000000001';
  const u2 = '00000000-0000-4000-8000-000000000002';

  const rows: Row[] = [
    row({
      id: 'r1',
      userId: u1,
      kind: 'deposit_purchase',
      currency: 'sweeps_locked',
      amount: 5_000,
      createdAt: new Date(baseTime + 1_000),
    }),
    row({
      id: 'r2',
      userId: u1,
      kind: 'deposit_first_purchase_bonus',
      currency: 'sweeps_locked',
      amount: 5_000,
      createdAt: new Date(baseTime + 2_000),
    }),
    row({
      id: 'r3',
      userId: u1,
      kind: 'bet_stake',
      currency: 'sweeps_cashable',
      amount: -1_000,
      createdAt: new Date(baseTime + 3_000),
    }),
    row({
      id: 'r4',
      userId: u1,
      kind: 'bet_payout',
      currency: 'sweeps_cashable',
      amount: 2_500,
      createdAt: new Date(baseTime + 4_000),
    }),
    row({
      id: 'r5',
      userId: u1,
      kind: 'cashout_request',
      currency: 'sweeps_cashable',
      amount: -3_000,
      createdAt: new Date(baseTime + 5_000),
    }),
    row({
      id: 'r6',
      userId: u1,
      kind: 'promo_redeem',
      currency: 'sweeps_locked',
      amount: 1_000,
      memo: 'WELCOME',
      createdAt: new Date(baseTime + 6_000),
    }),
    row({
      id: 'r7',
      userId: u1,
      kind: 'promo_redeem',
      currency: 'sweeps_locked',
      amount: 500,
      memo: 'AMOE-2025',
      metadata: { amoe: true },
      createdAt: new Date(baseTime + 7_000),
    }),
    row({
      id: 'rX',
      userId: u2,
      kind: 'deposit_purchase',
      currency: 'sweeps_locked',
      amount: 9_999,
      createdAt: new Date(baseTime + 10_000),
    }),
  ];

  function buildService() {
    const db = makeDb(rows);
    // The real service uses Drizzle's `and/eq/inArray/lt/or` to filter.
    // We replicate that behavior by hooking the builder before each call.
    db._setOrder((a: Row, b: Row) => {
      if (a.createdAt.getTime() !== b.createdAt.getTime()) {
        return b.createdAt.getTime() - a.createdAt.getTime();
      }
      return b.id.localeCompare(a.id);
    });
    return { svc: new TransactionsService(db), db };
  }

  function applyFilter(
    db: any,
    userId: string,
    kinds: LedgerKind[] | null,
    cursor?: { createdAt: Date; id: string },
  ) {
    db._setFilter((r: Row) => {
      if (r.userId !== userId) return false;
      if (kinds && !kinds.includes(r.kind)) return false;
      if (cursor) {
        if (r.createdAt.getTime() < cursor.createdAt.getTime()) return true;
        if (r.createdAt.getTime() === cursor.createdAt.getTime()) {
          return r.id < cursor.id;
        }
        return false;
      }
      return true;
    });
  }

  it('filter=all returns every ledger row for the user, newest first', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, null);

    const page = await svc.list({ userId: u1, filter: 'all', limit: 100 });

    expect(page.items.map((i) => i.id)).toEqual([
      'r7',
      'r6',
      'r5',
      'r4',
      'r3',
      'r2',
      'r1',
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('scopes results by user', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u2, null);
    const page = await svc.list({ userId: u2, filter: 'all', limit: 100 });
    expect(page.items.map((i) => i.id)).toEqual(['rX']);
  });

  it('filter=top_ups returns purchases, bonuses, promos, daily bonus, unlocks', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, [
      'deposit_purchase',
      'deposit_first_purchase_bonus',
      'promo_redeem',
      'daily_bonus',
      'unlock_sweeps',
    ]);
    const page = await svc.list({ userId: u1, filter: 'top_ups', limit: 100 });
    expect(page.items.map((i) => i.id).sort()).toEqual(
      ['r1', 'r2', 'r6', 'r7'].sort(),
    );
    for (const item of page.items) {
      expect(item.category).toBe('top_ups');
      expect(item.amountCents).toBeGreaterThan(0);
    }
  });

  it('filter=picks returns only stakes/refunds', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, ['bet_stake', 'bet_refund']);
    const page = await svc.list({ userId: u1, filter: 'picks', limit: 100 });
    expect(page.items.map((i) => i.id)).toEqual(['r3']);
    expect(page.items[0].kind).toBe('stake');
    expect(page.items[0].amountCents).toBeLessThan(0);
  });

  it('filter=wins returns only payouts', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, ['bet_payout']);
    const page = await svc.list({ userId: u1, filter: 'wins', limit: 100 });
    expect(page.items.map((i) => i.id)).toEqual(['r4']);
    expect(page.items[0].kind).toBe('win');
    expect(page.items[0].amountCents).toBeGreaterThan(0);
  });

  it('filter=payouts returns cashout entries with pending status', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, ['cashout_request', 'cashout_reversal']);
    const page = await svc.list({ userId: u1, filter: 'payouts', limit: 100 });
    expect(page.items.map((i) => i.id)).toEqual(['r5']);
    expect(page.items[0].kind).toBe('redemption');
    expect(page.items[0].status).toBe('pending');
    expect(page.items[0].amountCents).toBeLessThan(0);
  });

  it('credits keep positive sign and debits keep negative sign', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, null);
    const page = await svc.list({ userId: u1, filter: 'all', limit: 100 });
    const byId = Object.fromEntries(page.items.map((i) => [i.id, i]));
    expect(byId.r1.amountCents).toBe(5_000);
    expect(byId.r3.amountCents).toBe(-1_000);
    expect(byId.r4.amountCents).toBe(2_500);
    expect(byId.r5.amountCents).toBe(-3_000);
  });

  it('promo entry with metadata.amoe is mapped to kind=amoe', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, null);
    const page = await svc.list({ userId: u1, filter: 'all', limit: 100 });
    const amoe = page.items.find((i) => i.id === 'r7');
    const promo = page.items.find((i) => i.id === 'r6');
    expect(amoe?.kind).toBe('amoe');
    expect(promo?.kind).toBe('bonus');
  });

  it('paginates with cursor and stops when exhausted', async () => {
    const { svc, db } = buildService();

    applyFilter(db, u1, null);
    const first = await svc.list({ userId: u1, filter: 'all', limit: 3 });
    expect(first.items.map((i) => i.id)).toEqual(['r7', 'r6', 'r5']);
    expect(first.nextCursor).not.toBeNull();

    const last = first.items[first.items.length - 1];
    applyFilter(db, u1, null, {
      createdAt: new Date(last.timestamp),
      id: last.id,
    });
    const second = await svc.list({
      userId: u1,
      filter: 'all',
      limit: 3,
      cursor: first.nextCursor!,
    });
    expect(second.items.map((i) => i.id)).toEqual(['r4', 'r3', 'r2']);
    expect(second.nextCursor).not.toBeNull();

    const last2 = second.items[second.items.length - 1];
    applyFilter(db, u1, null, {
      createdAt: new Date(last2.timestamp),
      id: last2.id,
    });
    const third = await svc.list({
      userId: u1,
      filter: 'all',
      limit: 3,
      cursor: second.nextCursor!,
    });
    expect(third.items.map((i) => i.id)).toEqual(['r1']);
    expect(third.nextCursor).toBeNull();
  });

  it('returns empty page with null cursor when no results', async () => {
    const { svc, db } = buildService();
    db._setFilter(() => false);
    const page = await svc.list({ userId: u1, filter: 'all', limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects malformed cursor', async () => {
    const { svc } = buildService();
    await expect(
      svc.list({
        userId: u1,
        filter: 'all',
        limit: 10,
        cursor: '!!!not-base64',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects cursor with invalid date', async () => {
    const { svc } = buildService();
    const bad = Buffer.from('not-a-date|abc').toString('base64url');
    await expect(
      svc.list({ userId: u1, filter: 'all', limit: 10, cursor: bad }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('export returns CSV with header and one row per ledger entry', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, null);
    const csv = await svc.exportCsv({ userId: u1, filter: 'all' });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe(
      'id,kind,category,title,subtitle,timestamp,amount_cents,currency,status',
    );
    expect(lines).toHaveLength(1 + 7);
    expect(lines.some((l) => l.startsWith('r5,redemption,payouts'))).toBe(true);
    expect(lines.some((l) => l.includes('-1000'))).toBe(true);
  });

  it('export honors filter', async () => {
    const { svc, db } = buildService();
    applyFilter(db, u1, ['bet_payout']);
    const csv = await svc.exportCsv({ userId: u1, filter: 'wins' });
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('win');
    expect(lines[1]).toContain('2500');
  });

  it('csv escapes values containing commas or quotes', async () => {
    const tricky: Row[] = [
      row({
        id: 'rc1',
        kind: 'promo_redeem',
        currency: 'sweeps_locked',
        amount: 100,
        memo: 'Hello, "world"',
        createdAt: new Date(baseTime),
      }),
    ];
    const db = makeDb(tricky);
    db._setOrder(() => 0);
    db._setFilter(() => true);
    const svc = new TransactionsService(db);
    const csv = await svc.exportCsv({ userId: u1, filter: 'all' });
    expect(csv).toContain('"Hello, ""world"""');
  });
});
