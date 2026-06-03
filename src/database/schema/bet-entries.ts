import { relations } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { betEntryStatusEnum, walletCurrencyEnum } from './enums';
import { users } from './users';

export const betEntries = pgTable(
  'bet_entries',
  {
    id: uuid('id').primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    status: betEntryStatusEnum('status').notNull().default('pending'),
    currency: walletCurrencyEnum('currency').notNull(),

    pickCount: integer('pick_count').notNull(),

    stakeAmountCents: bigint('stake_amount_cents', { mode: 'number' }).notNull(),
    payoutMultiplierX100: integer('payout_multiplier_x100').notNull(),
    potentialPayoutCents: bigint('potential_payout_cents', {
      mode: 'number',
    }).notNull(),
    actualPayoutCents: bigint('actual_payout_cents', { mode: 'number' }),

    idempotencyKey: text('idempotency_key').notNull(),

    settledAt: timestamp('settled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('bet_entries_user_idem_uq').on(t.userId, t.idempotencyKey),
    index('bet_entries_user_created_idx').on(t.userId, t.createdAt),
    index('bet_entries_status_idx').on(t.status),
    index('bet_entries_user_status_idx').on(t.userId, t.status),
  ],
);

export const betEntriesRelations = relations(betEntries, ({ one }) => ({
  user: one(users, {
    fields: [betEntries.userId],
    references: [users.id],
  }),
}));

export type BetEntryRow = typeof betEntries.$inferSelect;
export type NewBetEntryRow = typeof betEntries.$inferInsert;
