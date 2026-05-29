import {
  bigint,
  boolean,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const coinPackages = pgTable(
  'coin_packages',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),

    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),

    priceCents: integer('price_cents').notNull(),

    sweepsCents: bigint('sweeps_cents', { mode: 'number' }).notNull(),

    bonusPercent: smallint('bonus_percent').notNull().default(0),

    badge: text('badge'),
    sortOrder: smallint('sort_order').notNull().default(0),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex('coin_packages_code_uq').on(t.code)],
);

export type CoinPackageRow = typeof coinPackages.$inferSelect;
export type NewCoinPackageRow = typeof coinPackages.$inferInsert;
