import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ledgerKindEnum, walletCurrencyEnum } from './enums';
import { users } from './users';

export const walletLedger = pgTable(
  'wallet_ledger',
  {
    id: uuid('id').primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    kind: ledgerKindEnum('kind').notNull(),
    currency: walletCurrencyEnum('currency').notNull(),

    amount: bigint('amount', { mode: 'number' }).notNull(),
    balanceAfter: bigint('balance_after', { mode: 'number' }).notNull(),

    referenceType: text('reference_type'),
    referenceId: text('reference_id'),

    idempotencyKey: text('idempotency_key'),

    memo: text('memo'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('wallet_ledger_user_idx').on(t.userId, t.createdAt),
    index('wallet_ledger_user_currency_idx').on(t.userId, t.currency),
    index('wallet_ledger_reference_idx').on(t.referenceType, t.referenceId),
    uniqueIndex('wallet_ledger_idem_uq')
      .on(t.userId, t.kind, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

export const walletLedgerRelations = relations(walletLedger, ({ one }) => ({
  user: one(users, {
    fields: [walletLedger.userId],
    references: [users.id],
  }),
}));

export type WalletLedgerRow = typeof walletLedger.$inferSelect;
export type NewWalletLedgerRow = typeof walletLedger.$inferInsert;
