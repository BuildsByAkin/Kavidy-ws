import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const CreateCheckoutSchema = z.object({
  packageId: z.coerce.number().int().positive(),
});
export class CreateCheckoutDto extends createZodDto(CreateCheckoutSchema) {}

export const RedeemPromoSchema = z.object({
  code: z.string().trim().min(3).max(40),
});
export class RedeemPromoDto extends createZodDto(RedeemPromoSchema) {}

export const SimulatePaymentSchema = z.object({
  outcome: z.enum(['completed', 'failed', 'expired']).default('completed'),
});
export class SimulatePaymentDto extends createZodDto(SimulatePaymentSchema) {}

export const TRANSACTION_FILTERS = [
  'all',
  'top_ups',
  'wins',
  'picks',
  'payouts',
] as const;

export const ListTransactionsQuerySchema = z.object({
  filter: z.enum(TRANSACTION_FILTERS).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(256).optional(),
});
export class ListTransactionsQueryDto extends createZodDto(
  ListTransactionsQuerySchema,
) {}

export const ExportTransactionsQuerySchema = z.object({
  filter: z.enum(TRANSACTION_FILTERS).default('all'),
});
export class ExportTransactionsQueryDto extends createZodDto(
  ExportTransactionsQuerySchema,
) {}
