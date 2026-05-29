import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { postLikes, posts, type PostRow } from '../database/schema/posts';
import { streamers, type StreamerRow } from '../database/schema/streamers';
import { users } from '../database/schema/users';
import { POST_BODY_MAX, POST_BODY_MIN } from './dto/ideas.dto';
import { toPublicPost, type PublicPost } from './ideas.mapper';

export interface ListFeedParams {
  viewerId: string;
  limit: number;
  cursor?: string;
}

export interface FeedPage {
  items: PublicPost[];
  nextCursor: string | null;
}

export interface CreatePostInput {
  userId: string;
  body: string;
  streamerId?: number;
}

export interface LikeResult {
  liked: boolean;
  likeCount: number;
}

interface CursorPayload {
  pinned: boolean;
  createdAt: Date;
  id: string;
}

@Injectable()
export class IdeasService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async listFeed(params: ListFeedParams): Promise<FeedPage> {
    const cursor = parseCursor(params.cursor);

    const conditions: SQL[] = [];
    if (cursor) {
      conditions.push(
        or(
          lt(posts.pinned, cursor.pinned),
          and(
            eq(posts.pinned, cursor.pinned),
            or(
              lt(posts.createdAt, cursor.createdAt),
              and(
                eq(posts.createdAt, cursor.createdAt),
                lt(posts.id, cursor.id),
              ),
            ),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(posts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(posts.pinned), desc(posts.createdAt), desc(posts.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;

    if (sliced.length === 0) {
      return { items: [], nextCursor: null };
    }

    const authorIds = unique(sliced.map((p) => p.userId));
    const streamerIds = unique(
      sliced
        .map((p) => p.streamerId)
        .filter((id): id is number => typeof id === 'number'),
    );
    const postIds = sliced.map((p) => p.id);

    const [authors, streamerRows, likedRows] = await Promise.all([
      this.db.select().from(users).where(inArray(users.id, authorIds)),
      streamerIds.length > 0
        ? this.db
            .select()
            .from(streamers)
            .where(inArray(streamers.id, streamerIds))
        : Promise.resolve([] as StreamerRow[]),
      this.db
        .select({ postId: postLikes.postId })
        .from(postLikes)
        .where(
          and(
            eq(postLikes.userId, params.viewerId),
            inArray(postLikes.postId, postIds),
          ),
        ),
    ]);

    const authorsById = new Map(authors.map((u) => [u.id, u]));
    const streamersById = new Map(streamerRows.map((s) => [s.id, s]));
    const likedSet = new Set(likedRows.map((r) => r.postId));

    const items = sliced
      .map((p) => {
        const author = authorsById.get(p.userId);
        if (!author) return null;
        const streamer =
          p.streamerId != null
            ? (streamersById.get(p.streamerId) ?? null)
            : null;
        return toPublicPost(p, author, streamer, likedSet.has(p.id));
      })
      .filter((item): item is PublicPost => item !== null);

    const last = sliced[sliced.length - 1];
    const nextCursor = hasMore ? buildCursor(last) : null;

    return { items, nextCursor };
  }

  async createPost(input: CreatePostInput): Promise<PublicPost> {
    const body = input.body.trim();
    if (body.length < POST_BODY_MIN || body.length > POST_BODY_MAX) {
      throw new BadRequestException(
        `Post body must be between ${POST_BODY_MIN} and ${POST_BODY_MAX} characters`,
      );
    }

    let streamerRow: StreamerRow | null = null;
    if (input.streamerId != null) {
      const [s] = await this.db
        .select()
        .from(streamers)
        .where(eq(streamers.id, input.streamerId))
        .limit(1);
      if (!s || !s.active) {
        throw new NotFoundException('Streamer not found');
      }
      streamerRow = s;
    }

    const id = randomUUID();
    const inserted = await this.db.transaction(async (tx) => {
      const [post] = await tx
        .insert(posts)
        .values({
          id,
          userId: input.userId,
          body,
          streamerId: streamerRow?.id ?? null,
        })
        .returning();
      const [author] = await tx
        .select()
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!author) {
        throw new ForbiddenException('Author not found');
      }
      return { post, author };
    });

    return toPublicPost(inserted.post, inserted.author, streamerRow, false);
  }

  async like(postId: string, userId: string): Promise<LikeResult> {
    return this.db.transaction(async (tx) => {
      const [post] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1)
        .for('update');
      if (!post) {
        throw new NotFoundException('Post not found');
      }

      const inserted = await tx
        .insert(postLikes)
        .values({ id: randomUUID(), postId, userId })
        .onConflictDoNothing({
          target: [postLikes.userId, postLikes.postId],
        })
        .returning({ id: postLikes.id });

      if (inserted.length === 0) {
        return { liked: true, likeCount: post.likeCount };
      }

      const [updated] = await tx
        .update(posts)
        .set({
          likeCount: sql`${posts.likeCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId))
        .returning({ likeCount: posts.likeCount });

      return { liked: true, likeCount: updated.likeCount };
    });
  }

  async unlike(postId: string, userId: string): Promise<LikeResult> {
    return this.db.transaction(async (tx) => {
      const [post] = await tx
        .select()
        .from(posts)
        .where(eq(posts.id, postId))
        .limit(1)
        .for('update');
      if (!post) {
        throw new NotFoundException('Post not found');
      }

      const deleted = await tx
        .delete(postLikes)
        .where(and(eq(postLikes.postId, postId), eq(postLikes.userId, userId)))
        .returning({ id: postLikes.id });

      if (deleted.length === 0) {
        return { liked: false, likeCount: post.likeCount };
      }

      const [updated] = await tx
        .update(posts)
        .set({
          likeCount: sql`greatest(${posts.likeCount} - 1, 0)`,
          updatedAt: new Date(),
        })
        .where(eq(posts.id, postId))
        .returning({ likeCount: posts.likeCount });

      return { liked: false, likeCount: updated.likeCount };
    });
  }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function parseCursor(raw: string | undefined): CursorPayload | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  const parts = decoded.split('|');
  if (parts.length !== 3) throw new BadRequestException('Invalid cursor');
  const [pinnedStr, createdAtIso, id] = parts;
  const createdAt = new Date(createdAtIso);
  if (
    (pinnedStr !== 'p' && pinnedStr !== 'u') ||
    Number.isNaN(createdAt.getTime()) ||
    !id
  ) {
    throw new BadRequestException('Invalid cursor');
  }
  return { pinned: pinnedStr === 'p', createdAt, id };
}

function buildCursor(row: PostRow): string {
  const payload = `${row.pinned ? 'p' : 'u'}|${row.createdAt.toISOString()}|${row.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}
