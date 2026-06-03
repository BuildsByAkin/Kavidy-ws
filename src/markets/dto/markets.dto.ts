import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const MARKET_STATUSES = [
  'proposed',
  'open',
  'resolved_yes',
  'resolved_no',
  'void',
  'abandoned',
] as const;

export const MARKET_CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

export const CREATOR_PLATFORMS = ['twitch', 'kick', 'youtube'] as const;

const MarketEvidenceSchema = z.object({
  platform: z.string().min(1).max(50),
  summary: z.string().min(1).max(500),
  source_url: z.string().url().nullable().optional(),
  observed_at: z.string().datetime({ offset: true }),
});

export const UpsertMarketSchema = z.object({
  id: z.string().min(1).max(255),
  creator_id: z.string().min(1).max(100),
  creator_display_name: z.string().min(1).max(255),
  creator_primary_platform: z.enum(CREATOR_PLATFORMS),
  question: z.string().min(1).max(1000),
  kind: z.string().min(1).max(100),
  status: z.enum(MARKET_STATUSES),
  confidence_level: z.enum(MARKET_CONFIDENCE_LEVELS),
  opens_at: z.string().datetime({ offset: true }),
  resolves_at: z.string().datetime({ offset: true }),
  generated_at: z.string().datetime({ offset: true }),
  resolved_at: z.string().datetime({ offset: true }).nullable().optional(),
  evidence: z.array(MarketEvidenceSchema).max(10).default([]),
});

export class UpsertMarketDto extends createZodDto(UpsertMarketSchema) {}

export const UpsertBulkMarketsSchema = z.object({
  markets: z.array(UpsertMarketSchema).min(1).max(100),
});
export class UpsertBulkMarketsDto extends createZodDto(
  UpsertBulkMarketsSchema,
) {}

export const ListMarketsQuerySchema = z.object({
  status: z.enum(MARKET_STATUSES).optional(),
  creator_id: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
export class ListMarketsQueryDto extends createZodDto(ListMarketsQuerySchema) {}
