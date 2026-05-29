import { relations } from 'drizzle-orm';
import { bigint, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

export const balances = pgTable('balances', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  sweepsCashableCents: bigint('sweeps_cashable_cents', { mode: 'number' })
    .notNull()
    .default(0),
  sweepsLockedCents: bigint('sweeps_locked_cents', { mode: 'number' })
    .notNull()
    .default(0),

  playthroughRemainingCents: bigint('playthrough_remaining_cents', {
    mode: 'number',
  })
    .notNull()
    .default(0),

  lifetimeDepositsCents: bigint('lifetime_deposits_cents', { mode: 'number' })
    .notNull()
    .default(0),

  version: bigint('version', { mode: 'number' }).notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const balancesRelations = relations(balances, ({ one }) => ({
  user: one(users, {
    fields: [balances.userId],
    references: [users.id],
  }),
}));

export type BalanceRow = typeof balances.$inferSelect;
export type NewBalanceRow = typeof balances.$inferInsert;
