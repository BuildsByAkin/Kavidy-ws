import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  postLikes,
  posts,
  type PostLikeRow,
  type PostRow,
} from '../database/schema/posts';
import { streamers, type StreamerRow } from '../database/schema/streamers';
import { users, type UserRow } from '../database/schema/users';
import { IdeasService } from './ideas.service';

type AnyRow = Record<string, unknown>;

const STORE_SYMBOL = Symbol.for('kavidy.test.table');

function tag(table: object, name: string): void {
  Object.defineProperty(table, STORE_SYMBOL, {
    value: name,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

tag(posts, 'posts');
tag(postLikes, 'post_likes');
tag(users, 'users');
tag(streamers, 'streamers');

interface State {
  users: UserRow[];
  streamers: StreamerRow[];
  posts: PostRow[];
  post_likes: PostLikeRow[];
  selectFilters: Array<(row: AnyRow, table: string) => boolean>;
  selectOrders: Array<(a: AnyRow, b: AnyRow) => number>;
}

function makeDb(state: State) {
  function tableName(table: any): string {
    return table?.[STORE_SYMBOL] as string;
  }

  function rowsFor(name: string): AnyRow[] {
    return (state as any)[name] as AnyRow[];
  }

  // A scoped query builder for `select`
  function makeSelect() {
    let pickedTable: string | null = null;
    let projection: Record<string, unknown> | null = null;
    let limitN: number | null = null;
    const builder: any = {
      from(table: any) {
        pickedTable = tableName(table);
        return builder;
      },
      where(_cond: unknown) {
        return builder;
      },
      orderBy(..._args: unknown[]) {
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      for(_mode: string) {
        return builder;
      },
      then(resolve: any, reject: any) {
        return run().then(resolve, reject);
      },
    };
    function run(): Promise<AnyRow[]> {
      const name = pickedTable!;
      let rows = [...rowsFor(name)];
      for (const f of state.selectFilters) {
        rows = rows.filter((r) => f(r, name));
      }
      for (const o of state.selectOrders) {
        rows.sort(o);
      }
      if (limitN != null) rows = rows.slice(0, limitN);
      if (projection) {
        rows = rows.map((r) =>
          Object.fromEntries(Object.keys(projection!).map((k) => [k, r[k]])),
        );
      }
      return Promise.resolve(rows);
    }
    builder._setProjection = (p: Record<string, unknown>) => {
      projection = p;
    };
    return builder;
  }

  const db: any = {
    select(projection?: Record<string, unknown>) {
      const b = makeSelect();
      if (projection) b._setProjection(projection);
      return b;
    },
    insert(table: any) {
      const name = tableName(table);
      let toInsert: AnyRow | null = null;
      let onConflict = false;
      const builder: any = {
        values(v: AnyRow) {
          toInsert = v;
          return builder;
        },
        onConflictDoNothing(_: unknown) {
          onConflict = true;
          return builder;
        },
        returning(_proj?: Record<string, unknown>) {
          const rows = rowsFor(name);
          if (onConflict && name === 'post_likes') {
            const dup = rows.find(
              (r: any) =>
                r.userId === (toInsert as any).userId &&
                r.postId === (toInsert as any).postId,
            );
            if (dup) return Promise.resolve([]);
          }
          const row: AnyRow = {
            ...toInsert,
            createdAt: (toInsert as any).createdAt ?? new Date(),
            updatedAt: (toInsert as any).updatedAt ?? new Date(),
            pinned: (toInsert as any).pinned ?? false,
            likeCount: (toInsert as any).likeCount ?? 0,
            streamerId: (toInsert as any).streamerId ?? null,
          };
          rows.push(row);
          return Promise.resolve([row]);
        },
      };
      return builder;
    },
    update(table: any) {
      const name = tableName(table);
      let patch: AnyRow = {};
      const builder: any = {
        set(p: AnyRow) {
          patch = p;
          return builder;
        },
        where(_cond: unknown) {
          return builder;
        },
        returning(_proj?: Record<string, unknown>) {
          const rows = rowsFor(name);
          const matchedRows = rows.filter((r) =>
            state.selectFilters.every((f) => f(r, name)),
          );
          for (const r of matchedRows) {
            for (const k of Object.keys(patch)) {
              const v = (patch as any)[k];
              if (k === 'likeCount') {
                const repr = sqlRepr(v);
                if (repr.includes('greatest') || repr.includes('- 1')) {
                  (r as any).likeCount = Math.max(
                    ((r as any).likeCount as number) - 1,
                    0,
                  );
                } else if (repr.includes('+ 1')) {
                  (r as any).likeCount = ((r as any).likeCount as number) + 1;
                } else if (typeof v === 'number') {
                  (r as any).likeCount = v;
                }
              } else {
                (r as any)[k] = v;
              }
            }
          }
          return Promise.resolve(matchedRows);
        },
      };
      return builder;
    },
    delete(table: any) {
      const name = tableName(table);
      const builder: any = {
        where(_cond: unknown) {
          return builder;
        },
        returning(_proj?: Record<string, unknown>) {
          const rows = rowsFor(name);
          const keep: AnyRow[] = [];
          const removed: AnyRow[] = [];
          for (const r of rows) {
            const matched = state.selectFilters.every((f) => f(r, name));
            if (matched) removed.push(r);
            else keep.push(r);
          }
          (state as any)[name] = keep;
          return Promise.resolve(removed);
        },
      };
      return builder;
    },
    async transaction(fn: (tx: any) => Promise<unknown>) {
      return fn(db);
    },
  };
  return db;
}

function sqlRepr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  const chunks = (v as any).queryChunks;
  if (Array.isArray(chunks)) {
    return chunks
      .map((c) => (typeof c === 'string' ? c : (c?.value ?? '')))
      .join(' ');
  }
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

function setFilters(
  state: State,
  fns: Array<(row: AnyRow, table: string) => boolean>,
  orders: Array<(a: AnyRow, b: AnyRow) => number> = [],
) {
  state.selectFilters = fns;
  state.selectOrders = orders;
}

function makeUser(id: string, username = 'alice'): UserRow {
  return {
    id,
    email: `${username}@kavidy.test`,
    username,
    passwordHash: 'x',
    emailVerified: true,
    emailVerifiedAt: new Date(),
    status: 'active',
    role: 'user',
    onboardingStatus: 'active',
    displayName: username,
    avatarUrl: null,
    dateOfBirth: '1995-01-01',
    country: 'US',
    state: 'NY',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeStreamer(id: number, handle = 'xqc'): StreamerRow {
  return {
    id,
    handle,
    displayName: handle,
    platform: 'kick',
    avatarUrl: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makePost(
  id: string,
  userId: string,
  createdAt: Date,
  opts: Partial<PostRow> = {},
): PostRow {
  return {
    id,
    userId,
    body: 'hello world',
    streamerId: null,
    pinned: false,
    likeCount: 0,
    createdAt,
    updatedAt: createdAt,
    ...opts,
  };
}

describe('IdeasService', () => {
  const userA = '00000000-0000-4000-8000-00000000000a';
  const userB = '00000000-0000-4000-8000-00000000000b';

  function buildState(): State {
    return {
      users: [makeUser(userA, 'alice'), makeUser(userB, 'bob')],
      streamers: [makeStreamer(1, 'xqc')],
      posts: [],
      post_likes: [],
      selectFilters: [],
      selectOrders: [],
    };
  }

  describe('createPost', () => {
    it('inserts a post and returns the public shape with the author', async () => {
      const state = buildState();
      const db = makeDb(state);
      const svc = new IdeasService(db);

      // first select is the author lookup inside the tx
      setFilters(state, [(r, t) => t === 'users' && r.id === userA]);
      const result = await svc.createPost({
        userId: userA,
        body: 'first post here',
      });

      expect(result.body).toBe('first post here');
      expect(result.author.id).toBe(userA);
      expect(result.streamer).toBeNull();
      expect(result.likeCount).toBe(0);
      expect(result.likedByMe).toBe(false);
      expect(state.posts).toHaveLength(1);
    });

    it('rejects bodies shorter than 6 chars', async () => {
      const state = buildState();
      const svc = new IdeasService(makeDb(state));
      await expect(
        svc.createPost({ userId: userA, body: 'hey' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects bodies longer than 280 chars', async () => {
      const state = buildState();
      const svc = new IdeasService(makeDb(state));
      await expect(
        svc.createPost({ userId: userA, body: 'a'.repeat(281) }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('trims whitespace before validating length', async () => {
      const state = buildState();
      const svc = new IdeasService(makeDb(state));
      await expect(
        svc.createPost({ userId: userA, body: '   hi   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('attaches an existing active streamer', async () => {
      const state = buildState();
      const db = makeDb(state);
      const svc = new IdeasService(db);

      setFilters(state, [
        (r, t) =>
          (t === 'streamers' && (r as any).id === 1) ||
          (t === 'users' && r.id === userA),
      ]);
      const result = await svc.createPost({
        userId: userA,
        body: 'tagging xqc',
        streamerId: 1,
      });
      expect(result.streamer?.id).toBe(1);
    });

    it('404s when streamerId does not exist', async () => {
      const state = buildState();
      const svc = new IdeasService(makeDb(state));
      setFilters(state, [() => false]);
      await expect(
        svc.createPost({
          userId: userA,
          body: 'tagging missing',
          streamerId: 999,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('404s when streamer is inactive', async () => {
      const state = buildState();
      state.streamers[0].active = false;
      const svc = new IdeasService(makeDb(state));
      setFilters(state, [(_r, t) => t === 'streamers']);
      await expect(
        svc.createPost({
          userId: userA,
          body: 'tagging inactive',
          streamerId: 1,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('like / unlike (idempotency)', () => {
    it('like inserts a row and increments like_count', async () => {
      const state = buildState();
      const post = makePost('p1', userA, new Date());
      state.posts.push(post);

      const db = makeDb(state);
      const svc = new IdeasService(db);

      setFilters(state, [(r, t) => t === 'posts' && (r as any).id === 'p1']);
      const res = await svc.like('p1', userB);

      expect(res.liked).toBe(true);
      expect(res.likeCount).toBe(1);
      expect(state.post_likes).toHaveLength(1);
    });

    it('liking twice is idempotent — no duplicate row, no double-increment', async () => {
      const state = buildState();
      const post = makePost('p1', userA, new Date());
      state.posts.push(post);
      const db = makeDb(state);
      const svc = new IdeasService(db);

      setFilters(state, [(r, t) => t === 'posts' && (r as any).id === 'p1']);
      await svc.like('p1', userB);

      setFilters(state, [(r, t) => t === 'posts' && (r as any).id === 'p1']);
      const second = await svc.like('p1', userB);

      expect(second.liked).toBe(true);
      expect(state.post_likes).toHaveLength(1);
      expect(state.posts[0].likeCount).toBe(1);
    });

    it('two different users can like the same post', async () => {
      const state = buildState();
      state.posts.push(makePost('p1', userA, new Date()));
      const db = makeDb(state);
      const svc = new IdeasService(db);

      setFilters(state, [(r, t) => t === 'posts' && (r as any).id === 'p1']);
      await svc.like('p1', userA);
      setFilters(state, [(r, t) => t === 'posts' && (r as any).id === 'p1']);
      const res = await svc.like('p1', userB);

      expect(res.likeCount).toBe(2);
      expect(state.post_likes).toHaveLength(2);
    });

    it('unlike removes the like and decrements the count', async () => {
      const state = buildState();
      const post = makePost('p1', userA, new Date(), { likeCount: 1 });
      state.posts.push(post);
      state.post_likes.push({
        id: 'l1',
        postId: 'p1',
        userId: userB,
        createdAt: new Date(),
      });

      const db = makeDb(state);
      const svc = new IdeasService(db);

      setFilters(state, [
        (r, t) =>
          (t === 'posts' && (r as any).id === 'p1') ||
          (t === 'post_likes' &&
            (r as any).postId === 'p1' &&
            (r as any).userId === userB),
      ]);
      const res = await svc.unlike('p1', userB);

      expect(res.liked).toBe(false);
      expect(res.likeCount).toBe(0);
      expect(state.post_likes).toHaveLength(0);
    });

    it('unlike is a no-op when the user has not liked the post', async () => {
      const state = buildState();
      const post = makePost('p1', userA, new Date(), { likeCount: 0 });
      state.posts.push(post);

      const db = makeDb(state);
      const svc = new IdeasService(db);

      setFilters(state, [(r, t) => t === 'posts' && (r as any).id === 'p1']);
      const res = await svc.unlike('p1', userB);

      expect(res.liked).toBe(false);
      expect(res.likeCount).toBe(0);
    });

    it('like throws NotFound when the post does not exist', async () => {
      const state = buildState();
      const svc = new IdeasService(makeDb(state));
      setFilters(state, [() => false]);
      await expect(svc.like('p-missing', userA)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('listFeed', () => {
    it('returns posts with author info, like counts and likedByMe', async () => {
      const state = buildState();
      const t0 = new Date('2025-02-01T10:00:00.000Z');
      const t1 = new Date('2025-02-01T11:00:00.000Z');
      state.posts.push(
        makePost('p1', userA, t0, { likeCount: 2 }),
        makePost('p2', userB, t1, { likeCount: 0, streamerId: 1 }),
      );
      state.post_likes.push({
        id: 'l1',
        postId: 'p1',
        userId: userB,
        createdAt: new Date(),
      });

      const db = makeDb(state);
      const svc = new IdeasService(db);

      // posts: return all; users: filter to listed authors; streamers: filter to listed ids;
      // post_likes: filter to viewer + post ids in feed.
      setFilters(
        state,
        [
          (r, t) => {
            if (t === 'posts') return true;
            if (t === 'users') return true;
            if (t === 'streamers') return true;
            if (t === 'post_likes') return (r as any).userId === userB;
            return true;
          },
        ],
        [
          (a, b) => {
            // pinned desc, createdAt desc
            if ((a as any).pinned !== (b as any).pinned) {
              return (b as any).pinned ? 1 : -1;
            }
            return (
              ((b as any).createdAt as Date).getTime() -
              ((a as any).createdAt as Date).getTime()
            );
          },
        ],
      );

      const page = await svc.listFeed({ viewerId: userB, limit: 50 });

      expect(page.items.map((i) => i.id)).toEqual(['p2', 'p1']);
      const p1 = page.items.find((i) => i.id === 'p1')!;
      expect(p1.likedByMe).toBe(true);
      expect(p1.likeCount).toBe(2);
      expect(p1.author.id).toBe(userA);
      const p2 = page.items.find((i) => i.id === 'p2')!;
      expect(p2.likedByMe).toBe(false);
      expect(p2.streamer?.id).toBe(1);
    });

    it('orders pinned posts first, then newest', async () => {
      const state = buildState();
      const t0 = new Date('2025-02-01T10:00:00.000Z');
      const t1 = new Date('2025-02-01T11:00:00.000Z');
      const t2 = new Date('2025-02-01T12:00:00.000Z');
      state.posts.push(
        makePost('old-unpinned', userA, t0),
        makePost('newest-unpinned', userA, t2),
        makePost('pinned-old', userA, t1, { pinned: true }),
      );

      const db = makeDb(state);
      const svc = new IdeasService(db);

      setFilters(
        state,
        [() => true],
        [
          (a, b) => {
            if ((a as any).pinned !== (b as any).pinned) {
              return (b as any).pinned ? 1 : -1;
            }
            return (
              ((b as any).createdAt as Date).getTime() -
              ((a as any).createdAt as Date).getTime()
            );
          },
        ],
      );

      const page = await svc.listFeed({ viewerId: userB, limit: 50 });
      expect(page.items.map((i) => i.id)).toEqual([
        'pinned-old',
        'newest-unpinned',
        'old-unpinned',
      ]);
    });

    it('returns an empty page when there are no posts', async () => {
      const state = buildState();
      const svc = new IdeasService(makeDb(state));
      setFilters(state, [() => true]);
      const page = await svc.listFeed({ viewerId: userA, limit: 10 });
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it('rejects malformed cursor', async () => {
      const state = buildState();
      const svc = new IdeasService(makeDb(state));
      await expect(
        svc.listFeed({ viewerId: userA, limit: 10, cursor: 'not-valid!!!' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
