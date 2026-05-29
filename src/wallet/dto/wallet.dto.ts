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
