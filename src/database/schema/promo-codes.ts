import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { promoKindEnum } from './enums';
import { users } from './users';

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    code: text('code').notNull(),
    description: text('description'),

    kind: promoKindEnum('kind').notNull(),

    sweepsCents: bigint('sweeps_cents', { mode: 'number' })
      .notNull()
      .default(0),

    maxRedemptions: integer('max_redemptions'),
    maxPerUser: integer('max_per_user').notNull().default(1),

    redemptionCount: integer('redemption_count').notNull().default(0),

    startsAt: timestamp('starts_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('promo_codes_code_uq').on(t.code)],
);

export const promoRedemptions = pgTable(
  'promo_redemptions',
  {
    id: uuid('id').primaryKey(),

    promoId: integer('promo_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'restrict' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    sweepsCents: bigint('sweeps_cents', { mode: 'number' })
      .notNull()
      .default(0),

    idempotencyKey: text('idempotency_key'),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('promo_redemptions_user_idx').on(t.userId),
    uniqueIndex('promo_redemptions_user_promo_uq').on(t.userId, t.promoId),
  ],
);

export const promoCodesRelations = relations(promoCodes, ({ many }) => ({
  redemptions: many(promoRedemptions),
}));

export const promoRedemptionsRelations = relations(
  promoRedemptions,
  ({ one }) => ({
    promo: one(promoCodes, {
      fields: [promoRedemptions.promoId],
      references: [promoCodes.id],
    }),
    user: one(users, {
      fields: [promoRedemptions.userId],
      references: [users.id],
    }),
  }),
);

export type PromoCodeRow = typeof promoCodes.$inferSelect;
export type NewPromoCodeRow = typeof promoCodes.$inferInsert;
export type PromoRedemptionRow = typeof promoRedemptions.$inferSelect;
export type NewPromoRedemptionRow = typeof promoRedemptions.$inferInsert;
