import { relations } from 'drizzle-orm';
import {
  bigint,
  date,
  integer,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const dailyBonusState = pgTable('daily_bonus_state', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),

  streakDays: integer('streak_days').notNull().default(0),

  lastClaimedDate: date('last_claimed_date', { mode: 'string' }),

  lastAwardedSweepsCents: bigint('last_awarded_sweeps_cents', {
    mode: 'number',
  })
    .notNull()
    .default(0),

  totalClaims: integer('total_claims').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dailyBonusStateRelations = relations(
  dailyBonusState,
  ({ one }) => ({
    user: one(users, {
      fields: [dailyBonusState.userId],
      references: [users.id],
    }),
  }),
);

export type DailyBonusStateRow = typeof dailyBonusState.$inferSelect;
export type NewDailyBonusStateRow = typeof dailyBonusState.$inferInsert;
