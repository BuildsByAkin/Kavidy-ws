import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { MAX_PICKS, MAX_STAKE_CENTS, MIN_PICKS, MIN_STAKE_CENTS } from '../bets.constants';

const PlaceEntryPickSchema = z.object({
  marketId: z.string().min(1).max(255),
  direction: z.enum(['yes', 'no']),
});

export const PlaceEntrySchema = z.object({
  picks: z
    .array(PlaceEntryPickSchema)
    .min(MIN_PICKS, `Minimum ${MIN_PICKS} picks required`)
    .max(MAX_PICKS, `Maximum ${MAX_PICKS} picks allowed`),
  stakeAmountCents: z
    .number()
    .int()
    .min(MIN_STAKE_CENTS, `Minimum stake is ${MIN_STAKE_CENTS} cents`)
    .max(MAX_STAKE_CENTS, `Maximum stake is ${MAX_STAKE_CENTS} cents`),
});

export class PlaceEntryDto extends createZodDto(PlaceEntrySchema) {}

export const ListEntriesQuerySchema = z.object({
  status: z.enum(['pending', 'won', 'lost', 'void']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});

export class ListEntriesQueryDto extends createZodDto(ListEntriesQuerySchema) {}
