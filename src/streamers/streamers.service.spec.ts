import type { StreamerRow } from '../database/schema/streamers';
import { StreamersService } from './streamers.service';

function makeRow(partial: Partial<StreamerRow> & { id: number }): StreamerRow {
  return {
    id: partial.id,
    handle: partial.handle ?? `handle${partial.id}`,
    displayName: partial.displayName ?? `Streamer ${partial.id}`,
    platform: partial.platform ?? 'kick',
    avatarUrl: partial.avatarUrl ?? null,
    active: partial.active ?? true,
    createdAt: partial.createdAt ?? new Date('2025-01-01T00:00:00.000Z'),
    updatedAt: partial.updatedAt ?? new Date('2025-01-01T00:00:00.000Z'),
  };
}

function makeDb(rows: StreamerRow[]) {
  let filter: (r: StreamerRow) => boolean = () => true;
  let order: (a: StreamerRow, b: StreamerRow) => number = () => 0;
  let limit = rows.length;

  const builder: any = {
    _setFilter(fn: (r: StreamerRow) => boolean) {
      filter = fn;
    },
    _setOrder(fn: (a: StreamerRow, b: StreamerRow) => number) {
      order = fn;
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
      limit = n;
      const out = [...rows].filter(filter).sort(order).slice(0, limit);
      return Promise.resolve(out);
    },
  };
  return builder;
}

describe('StreamersService', () => {
  const rows: StreamerRow[] = [
    makeRow({ id: 1, handle: 'trainwreckstv', displayName: 'Trainwreck' }),
    makeRow({ id: 2, handle: 'xqc', displayName: 'xQc', platform: 'twitch' }),
    makeRow({ id: 3, handle: 'rosters', displayName: 'Roshtein' }),
    makeRow({
      id: 4,
      handle: 'oldguy',
      displayName: 'Inactive Streamer',
      active: false,
    }),
  ];

  function build() {
    const db = makeDb(rows);
    db._setOrder((a: StreamerRow, b: StreamerRow) =>
      a.displayName.localeCompare(b.displayName),
    );
    return { svc: new StreamersService(db), db };
  }

  it('returns active streamers ordered by display name when no query', async () => {
    const { svc, db } = build();
    db._setFilter((r: StreamerRow) => r.active);

    const result = await svc.search({ limit: 10 });
    expect(result.map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it('matches by handle substring (case-insensitive)', async () => {
    const { svc, db } = build();
    db._setFilter(
      (r: StreamerRow) =>
        r.active &&
        (r.handle.toLowerCase().includes('xqc') ||
          r.displayName.toLowerCase().includes('xqc')),
    );

    const result = await svc.search({ q: 'XQC', limit: 10 });
    expect(result.map((r) => r.id)).toEqual([2]);
  });

  it('matches by display name', async () => {
    const { svc, db } = build();
    db._setFilter(
      (r: StreamerRow) =>
        r.active &&
        (r.handle.toLowerCase().includes('rosh') ||
          r.displayName.toLowerCase().includes('rosh')),
    );

    const result = await svc.search({ q: 'rosh', limit: 10 });
    expect(result.map((r) => r.id)).toEqual([3]);
  });

  it('honors the limit', async () => {
    const { svc, db } = build();
    db._setFilter((r: StreamerRow) => r.active);

    const result = await svc.search({ limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('excludes inactive streamers', async () => {
    const { svc, db } = build();
    db._setFilter((r: StreamerRow) => r.active);

    const result = await svc.search({ limit: 50 });
    expect(result.find((r) => r.id === 4)).toBeUndefined();
  });
});
