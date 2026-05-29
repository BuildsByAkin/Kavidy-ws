import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    familyId: uuid('family_id').notNull(),

    tokenHash: text('token_hash').notNull(),

    issuedAt: timestamp('issued_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
    }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    replacedById: uuid('replaced_by_id'),

    rememberMe: boolean('remember_me').notNull().default(true),

    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type NewRefreshTokenRow = typeof refreshTokens.$inferInsert;
