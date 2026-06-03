import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import {
  creatorPlatformEnum,
  marketConfidenceEnum,
  marketStatusEnum,
} from './enums';

export interface MarketEvidence {
  platform: string;
  summary: string;
  source_url: string | null;
  observed_at: string;
}

export const MARKET_TERMINAL_STATUSES = new Set([
  'resolved_yes',
  'resolved_no',
] as const);

export const markets = pgTable(
  'markets',
  {
    id: text('id').primaryKey(),

    creatorId: text('creator_id').notNull(),
    creatorDisplayName: text('creator_display_name').notNull(),
    creatorPrimaryPlatform: creatorPlatformEnum(
      'creator_primary_platform',
    ).notNull(),

    question: text('question').notNull(),
    kind: text('kind').notNull(),

    status: marketStatusEnum('status').notNull().default('proposed'),
    confidenceLevel: marketConfidenceEnum('confidence_level').notNull(),

    opensAt: timestamp('opens_at', { withTimezone: true }).notNull(),
    resolvesAt: timestamp('resolves_at', { withTimezone: true }).notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    evidence: jsonb('evidence').$type<MarketEvidence[]>().notNull().default([]),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('markets_creator_idx').on(t.creatorId),
    index('markets_status_idx').on(t.status),
    index('markets_resolves_at_idx').on(t.resolvesAt),
    index('markets_creator_status_idx').on(t.creatorId, t.status),
  ],
);

export type MarketRow = typeof markets.$inferSelect;
export type NewMarketRow = typeof markets.$inferInsert;
