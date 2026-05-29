import {
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey(),

    userId: uuid('user_id'),

    scope: text('scope').notNull(),
    key: text('key').notNull(),

    requestHash: text('request_hash'),

    statusCode: smallint('status_code'),
    response: jsonb('response').$type<unknown>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idempotency_keys_scope_user_key_uq').on(
      t.scope,
      t.userId,
      t.key,
    ),
    index('idempotency_keys_created_idx').on(t.createdAt),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKeyRow = typeof idempotencyKeys.$inferInsert;
