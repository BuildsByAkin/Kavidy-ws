import type { BetEntryRow } from '../database/schema/bet-entries';
import type { BetPickRow } from '../database/schema/bet-picks';
import { formatMultiplier } from './bets.constants';

export interface PublicPick {
  id: string;
  marketId: string;
  marketQuestion: string;
  direction: 'yes' | 'no';
  status: 'pending' | 'won' | 'lost' | 'void';
  marketResolvedStatus: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface PublicEntry {
  id: string;
  status: 'pending' | 'won' | 'lost' | 'void';
  currency: string;
  pickCount: number;
  stakeAmountCents: number;
  payoutMultiplierX100: number;
  multiplierDisplay: string;
  potentialPayoutCents: number;
  actualPayoutCents: number | null;
  picks: PublicPick[];
  settledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntryPage {
  items: PublicEntry[];
  nextCursor: string | null;
}

export function toPublicPick(row: BetPickRow): PublicPick {
  return {
    id: row.id,
    marketId: row.marketId,
    marketQuestion: row.marketQuestion,
    direction: row.direction,
    status: row.status,
    marketResolvedStatus: row.marketResolvedStatus ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPublicEntry(
  entry: BetEntryRow,
  picks: BetPickRow[],
): PublicEntry {
  return {
    id: entry.id,
    status: entry.status,
    currency: entry.currency,
    pickCount: entry.pickCount,
    stakeAmountCents: entry.stakeAmountCents,
    payoutMultiplierX100: entry.payoutMultiplierX100,
    multiplierDisplay: formatMultiplier(entry.payoutMultiplierX100),
    potentialPayoutCents: entry.potentialPayoutCents,
    actualPayoutCents: entry.actualPayoutCents ?? null,
    picks: picks.map(toPublicPick),
    settledAt: entry.settledAt?.toISOString() ?? null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}
