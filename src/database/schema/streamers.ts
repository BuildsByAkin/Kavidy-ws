import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { streamerPlatformEnum } from './enums';

export const streamers = pgTable(
  'streamers',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    handle: text('handle').notNull(),
    displayName: text('display_name').notNull(),
    platform: streamerPlatformEnum('platform').notNull(),

    avatarUrl: text('avatar_url'),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('streamers_platform_handle_lower_uq').on(
      t.platform,
      sql`lower(${t.handle})`,
    ),
    index('streamers_handle_lower_idx').on(sql`lower(${t.handle})`),
    index('streamers_display_name_lower_idx').on(sql`lower(${t.displayName})`),
    index('streamers_active_idx').on(t.active),
  ],
);

export type StreamerRow = typeof streamers.$inferSelect;
export type NewStreamerRow = typeof streamers.$inferInsert;
