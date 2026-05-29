import type { LedgerKind } from './ledger.service';

export type TransactionKind =
  | 'purchase'
  | 'bonus'
  | 'win'
  | 'stake'
  | 'redemption'
  | 'amoe';

export type TransactionCategory =
  | 'top_ups'
  | 'wins'
  | 'picks'
  | 'payouts'
  | 'other';

export type TransactionFilter =
  | 'all'
  | 'top_ups'
  | 'wins'
  | 'picks'
  | 'payouts';

export type TransactionStatus = 'completed' | 'pending' | 'failed' | 'reversed';

export interface TransactionItem {
  id: string;
  kind: TransactionKind;
  category: TransactionCategory;
  title: string;
  subtitle: string;
  timestamp: string;
  amountCents: number;
  currency: 'sweeps_cashable' | 'sweeps_locked';
  status: TransactionStatus;
}

export interface TransactionPage {
  items: TransactionItem[];
  nextCursor: string | null;
}

export const FILTER_TO_KINDS: Record<
  Exclude<TransactionFilter, 'all'>,
  LedgerKind[]
> = {
  top_ups: [
    'deposit_purchase',
    'deposit_first_purchase_bonus',
    'promo_redeem',
    'daily_bonus',
    'unlock_sweeps',
  ],
  wins: ['bet_payout'],
  picks: ['bet_stake', 'bet_refund'],
  payouts: ['cashout_request', 'cashout_reversal'],
};
