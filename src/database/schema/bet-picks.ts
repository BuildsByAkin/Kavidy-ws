import { relations } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { betPickDirectionEnum, betPickStatusEnum } from './enums';
import { betEntries } from './bet-entries';

export const betPicks = pgTable(
  'bet_picks',
  {
    id: uuid('id').primaryKey(),

    entryId: uuid('entry_id')
      .notNull()
      .references(() => betEntries.id, { onDelete: 'cascade' }),

    marketId: text('market_id').notNull(),

    direction: betPickDirectionEnum('direction').notNull(),
    status: betPickStatusEnum('status').notNull().default('pending'),

    marketQuestion: text('market_question').notNull(),

    marketResolvedStatus: text('market_resolved_status'),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('bet_picks_entry_market_uq').on(t.entryId, t.marketId),
    index('bet_picks_entry_idx').on(t.entryId),
    index('bet_picks_market_idx').on(t.marketId),
    index('bet_picks_market_status_idx').on(t.marketId, t.status),
  ],
);

export const betPicksRelations = relations(betPicks, ({ one }) => ({
  entry: one(betEntries, {
    fields: [betPicks.entryId],
    references: [betEntries.id],
  }),
}));

export type BetPickRow = typeof betPicks.$inferSelect;
export type NewBetPickRow = typeof betPicks.$inferInsert;
