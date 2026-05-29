import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  walletLedger,
  type WalletLedgerRow,
} from '../database/schema/wallet-ledger';
import type { LedgerKind } from './ledger.service';
import {
  FILTER_TO_KINDS,
  type TransactionCategory,
  type TransactionFilter,
  type TransactionItem,
  type TransactionKind,
  type TransactionPage,
  type TransactionStatus,
} from './transactions.types';

export interface ListTransactionsParams {
  userId: string;
  filter: TransactionFilter;
  limit: number;
  cursor?: string;
}

export interface ExportTransactionsParams {
  userId: string;
  filter: TransactionFilter;
}

const CSV_HEADER =
  'id,kind,category,title,subtitle,timestamp,amount_cents,currency,status\n';

@Injectable()
export class TransactionsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(params: ListTransactionsParams): Promise<TransactionPage> {
    const cursor = parseCursor(params.cursor);
    const kinds = kindsForFilter(params.filter);

    const conditions = [eq(walletLedger.userId, params.userId)];
    if (kinds) conditions.push(inArray(walletLedger.kind, kinds));
    if (cursor) {
      conditions.push(
        or(
          lt(walletLedger.createdAt, cursor.createdAt),
          and(
            eq(walletLedger.createdAt, cursor.createdAt),
            lt(walletLedger.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(walletLedger)
      .where(and(...conditions))
      .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;
    const items = sliced.map(toTransactionItem);
    const nextCursor =
      hasMore && sliced.length > 0
        ? buildCursor(sliced[sliced.length - 1])
        : null;

    return { items, nextCursor };
  }

  async exportCsv(params: ExportTransactionsParams): Promise<string> {
    const kinds = kindsForFilter(params.filter);
    const conditions = [eq(walletLedger.userId, params.userId)];
    if (kinds) conditions.push(inArray(walletLedger.kind, kinds));

    const rows = await this.db
      .select()
      .from(walletLedger)
      .where(and(...conditions))
      .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
      .limit(10_000);

    const lines = rows.map((row) => toCsvLine(toTransactionItem(row)));
    return CSV_HEADER + lines.join('\n') + (lines.length > 0 ? '\n' : '');
  }
}

function kindsForFilter(filter: TransactionFilter): LedgerKind[] | null {
  if (filter === 'all') return null;
  return FILTER_TO_KINDS[filter];
}

function parseCursor(
  raw: string | undefined,
): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  const sep = decoded.indexOf('|');
  if (sep < 0) throw new BadRequestException('Invalid cursor');
  const createdAtIso = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { createdAt, id };
}

function buildCursor(row: WalletLedgerRow): string {
  const payload = `${row.createdAt.toISOString()}|${row.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function toTransactionItem(row: WalletLedgerRow): TransactionItem {
  const mapping = mapKind(row);
  return {
    id: row.id,
    kind: mapping.kind,
    category: mapping.category,
    title: mapping.title,
    subtitle: mapping.subtitle(row),
    timestamp: row.createdAt.toISOString(),
    amountCents: row.amount,
    currency: row.currency,
    status: statusFor(row),
  };
}

interface KindMapping {
  kind: TransactionKind;
  category: TransactionCategory;
  title: string;
  subtitle: (row: WalletLedgerRow) => string;
}

function mapKind(row: WalletLedgerRow): KindMapping {
  const isAmoe = isAmoeEntry(row);

  switch (row.kind) {
    case 'deposit_purchase':
      return {
        kind: 'purchase',
        category: 'top_ups',
        title: 'Coin package purchase',
        subtitle: (r) => r.memo ?? 'Top-up',
      };
    case 'deposit_first_purchase_bonus':
      return {
        kind: 'bonus',
        category: 'top_ups',
        title: 'First-purchase bonus',
        subtitle: () => 'Sweeps Coins bonus',
      };
    case 'promo_redeem':
      return {
        kind: isAmoe ? 'amoe' : 'bonus',
        category: 'top_ups',
        title: isAmoe ? 'AMOE credit' : 'Promo code redeemed',
        subtitle: (r) => r.memo ?? (isAmoe ? 'Mail-in entry' : 'Promo'),
      };
    case 'daily_bonus':
      return {
        kind: 'bonus',
        category: 'top_ups',
        title: 'Daily check-in bonus',
        subtitle: () => 'Sweeps Coins',
      };
    case 'unlock_sweeps':
      return {
        kind: 'bonus',
        category: 'top_ups',
        title: 'Sweeps Coins unlocked',
        subtitle: () => 'Wagering complete',
      };
    case 'bet_stake':
      return {
        kind: 'stake',
        category: 'picks',
        title: 'Pick placed',
        subtitle: (r) => r.memo ?? 'Stake',
      };
    case 'bet_refund':
      return {
        kind: 'stake',
        category: 'picks',
        title: 'Pick refunded',
        subtitle: (r) => r.memo ?? 'Refund',
      };
    case 'bet_payout':
      return {
        kind: 'win',
        category: 'wins',
        title: 'Pick won',
        subtitle: (r) => r.memo ?? 'Payout',
      };
    case 'cashout_request':
      return {
        kind: 'redemption',
        category: 'payouts',
        title: 'Redemption requested',
        subtitle: (r) => r.memo ?? 'Cash out',
      };
    case 'cashout_reversal':
      return {
        kind: 'redemption',
        category: 'payouts',
        title: 'Redemption reversed',
        subtitle: (r) => r.memo ?? 'Cash out reversed',
      };
    case 'admin_adjustment':
      return {
        kind: row.amount >= 0 ? 'bonus' : 'stake',
        category: 'other',
        title: 'Account adjustment',
        subtitle: (r) => r.memo ?? 'Adjustment',
      };
  }
}

function isAmoeEntry(row: WalletLedgerRow): boolean {
  const md = row.metadata;
  if (md && typeof md === 'object' && 'amoe' in md) {
    return Boolean((md as { amoe?: unknown }).amoe);
  }
  return false;
}

function statusFor(row: WalletLedgerRow): TransactionStatus {
  if (row.kind === 'cashout_request') return 'pending';
  if (row.kind === 'cashout_reversal') return 'reversed';
  return 'completed';
}

function toCsvLine(item: TransactionItem): string {
  return [
    item.id,
    item.kind,
    item.category,
    item.title,
    item.subtitle,
    item.timestamp,
    item.amountCents,
    item.currency,
    item.status,
  ]
    .map(csvEscape)
    .join(',');
}

function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'number' ? value.toString() : value;
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
