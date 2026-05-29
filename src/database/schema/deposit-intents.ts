import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { coinPackages } from './coin-packages';
import { depositStatusEnum } from './enums';
import { users } from './users';

export const depositIntents = pgTable(
  'deposit_intents',
  {
    id: uuid('id').primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    packageId: integer('package_id')
      .notNull()
      .references(() => coinPackages.id, { onDelete: 'restrict' }),

    status: depositStatusEnum('status').notNull().default('pending'),

    priceCents: integer('price_cents').notNull(),
    baseSweepsCents: bigint('base_sweeps_cents', { mode: 'number' })
      .notNull()
      .default(0),
    bonusSweepsCents: bigint('bonus_sweeps_cents', { mode: 'number' })
      .notNull()
      .default(0),
    firstPurchaseApplied: boolean('first_purchase_applied')
      .notNull()
      .default(false),

    promoCode: text('promo_code'),
    promoSweepsCents: bigint('promo_sweeps_cents', { mode: 'number' })
      .notNull()
      .default(0),

    providerSessionId: text('provider_session_id'),
    providerPaymentRef: text('provider_payment_ref'),
    providerEventId: text('provider_event_id'),

    idempotencyKey: text('idempotency_key').notNull(),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('deposit_intents_user_idem_uq').on(t.userId, t.idempotencyKey),
    uniqueIndex('deposit_intents_provider_session_uq')
      .on(t.providerSessionId)
      .where(sql`${t.providerSessionId} IS NOT NULL`),
    index('deposit_intents_user_idx').on(t.userId, t.createdAt),
    index('deposit_intents_status_idx').on(t.status),
  ],
);

export const depositIntentsRelations = relations(depositIntents, ({ one }) => ({
  user: one(users, {
    fields: [depositIntents.userId],
    references: [users.id],
  }),
  coinPackage: one(coinPackages, {
    fields: [depositIntents.packageId],
    references: [coinPackages.id],
  }),
}));

export type DepositIntentRow = typeof depositIntents.$inferSelect;
export type NewDepositIntentRow = typeof depositIntents.$inferInsert;
