import type { MarketEvidence, MarketRow } from '../database/schema/markets';

export interface PublicMarket {
  id: string;
  creatorId: string;
  creatorDisplayName: string;
  creatorPrimaryPlatform: string;
  question: string;
  kind: string;
  status: string;
  confidenceLevel: string;
  opensAt: string;
  resolvesAt: string;
  generatedAt: string;
  resolvedAt: string | null;
  evidence: MarketEvidence[];
  createdAt: string;
  updatedAt: string;
}

export function toPublicMarket(row: MarketRow): PublicMarket {
  return {
    id: row.id,
    creatorId: row.creatorId,
    creatorDisplayName: row.creatorDisplayName,
    creatorPrimaryPlatform: row.creatorPrimaryPlatform,
    question: row.question,
    kind: row.kind,
    status: row.status,
    confidenceLevel: row.confidenceLevel,
    opensAt: row.opensAt.toISOString(),
    resolvesAt: row.resolvesAt.toISOString(),
    generatedAt: row.generatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    evidence: row.evidence,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
