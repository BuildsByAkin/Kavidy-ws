import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { streamers } from './streamers';
import { users } from './users';

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    body: text('body').notNull(),

    streamerId: integer('streamer_id').references(() => streamers.id, {
      onDelete: 'set null',
    }),

    pinned: boolean('pinned').notNull().default(false),

    likeCount: integer('like_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('posts_feed_idx').on(t.pinned, t.createdAt, t.id),
    index('posts_user_idx').on(t.userId, t.createdAt),
    index('posts_streamer_idx').on(t.streamerId),
    check(
      'posts_body_length_chk',
      sql`char_length(${t.body}) between 6 and 280`,
    ),
    check('posts_like_count_nonneg_chk', sql`${t.likeCount} >= 0`),
  ],
);

export const postsRelations = relations(posts, ({ one, many }) => ({
  user: one(users, { fields: [posts.userId], references: [users.id] }),
  streamer: one(streamers, {
    fields: [posts.streamerId],
    references: [streamers.id],
  }),
  likes: many(postLikes),
}));

export const postLikes = pgTable(
  'post_likes',
  {
    id: uuid('id').primaryKey(),

    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('post_likes_post_idx').on(t.postId),
    index('post_likes_user_idx').on(t.userId),
    uniqueIndex('post_likes_user_post_uq').on(t.userId, t.postId),
  ],
);

export const postLikesRelations = relations(postLikes, ({ one }) => ({
  post: one(posts, { fields: [postLikes.postId], references: [posts.id] }),
  user: one(users, { fields: [postLikes.userId], references: [users.id] }),
}));

export type PostRow = typeof posts.$inferSelect;
export type NewPostRow = typeof posts.$inferInsert;
export type PostLikeRow = typeof postLikes.$inferSelect;
export type NewPostLikeRow = typeof postLikes.$inferInsert;
