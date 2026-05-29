import { ConflictException } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

interface Row {
  id: string;
  userId: string | null;
  scope: string;
  key: string;
  requestHash: string | null;
  statusCode: number | null;
  response: unknown;
  completedAt: Date | null;
}

function makeDb() {
  const rows: Row[] = [];
  let nextSelectMatch: Row[] = [];

  const db: any = {
    rows,
    select() {
      return {
        from: () => ({
          where: () => ({
            limit: async () => nextSelectMatch.slice(),
          }),
        }),
      };
    },
    insert() {
      return {
        values: async (v: any) => {
          const dup = rows.find(
            (r) =>
              r.scope === v.scope && r.userId === v.userId && r.key === v.key,
          );
          if (dup) {
            const err: any = new Error('duplicate');
            err.code = '23505';
            throw err;
          }
          rows.push({
            id: v.id,
            userId: v.userId ?? null,
            scope: v.scope,
            key: v.key,
            requestHash: v.requestHash ?? null,
            statusCode: null,
            response: null,
            completedAt: null,
          });
        },
      };
    },
    update() {
      return {
        set: (patch: any) => ({
          where: () => {
            const id = patch.__id ?? null;
            void id;
            const last = rows[rows.length - 1];
            if (last) {
              last.completedAt = patch.completedAt ?? new Date();
              last.statusCode = patch.statusCode ?? 200;
              last.response = patch.response ?? null;
            }
            return Promise.resolve();
          },
        }),
      };
    },
    transaction: async (fn: any) => fn({}),
    setNextSelect(match: Row[]) {
      nextSelectMatch = match;
    },
  };
  return db;
}

describe('IdempotencyService', () => {
  it('runs the handler and stores result on first call', async () => {
    const db = makeDb();
    const svc = new IdempotencyService(db);
    const out = await svc.execute({
      scope: 'test',
      key: 'k1',
      userId: 'u1',
      requestPayload: { x: 1 },
      handler: async () => ({ ok: true, n: 42 }),
    });
    expect(out.replayed).toBe(false);
    expect(out.result).toEqual({ ok: true, n: 42 });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].response).toEqual({ ok: true, n: 42 });
    expect(db.rows[0].completedAt).toBeInstanceOf(Date);
  });

  it('replays cached response when same key is reused with same payload', async () => {
    const db = makeDb();
    const svc = new IdempotencyService(db);
    const handler = jest.fn(async () => ({ ok: true, value: 'first' }));
    await svc.execute({
      scope: 'test',
      key: 'k2',
      userId: 'u1',
      requestPayload: { a: 1 },
      handler,
    });

    db.setNextSelect([db.rows[0]]);
    const handler2 = jest.fn(async () => ({ ok: true, value: 'second' }));
    const out = await svc.execute({
      scope: 'test',
      key: 'k2',
      userId: 'u1',
      requestPayload: { a: 1 },
      handler: handler2,
    });

    expect(out.replayed).toBe(true);
    expect(out.result).toEqual({ ok: true, value: 'first' });
    expect(handler2).not.toHaveBeenCalled();
  });

  it('throws conflict when same key is reused with different payload', async () => {
    const db = makeDb();
    const svc = new IdempotencyService(db);
    await svc.execute({
      scope: 'test',
      key: 'k3',
      userId: 'u1',
      requestPayload: { a: 1 },
      handler: async () => ({ ok: true }),
    });

    db.setNextSelect([db.rows[0]]);
    await expect(
      svc.execute({
        scope: 'test',
        key: 'k3',
        userId: 'u1',
        requestPayload: { a: 2 },
        handler: async () => ({ ok: true }),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('treats null userId distinct from string userId', async () => {
    const db = makeDb();
    const svc = new IdempotencyService(db);
    await svc.execute({
      scope: 'test',
      key: 'k4',
      userId: null,
      handler: async () => 'anon',
    });
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].userId).toBeNull();
  });
});
