import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SearchStreamersQuerySchema = z.object({
  q: z.string().trim().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});
export class SearchStreamersQueryDto extends createZodDto(
  SearchStreamersQuerySchema,
) {}
