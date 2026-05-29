import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const POST_BODY_MIN = 6;
export const POST_BODY_MAX = 280;

export const CreatePostSchema = z.object({
  body: z
    .string()
    .trim()
    .min(
      POST_BODY_MIN,
      `Post body must be at least ${POST_BODY_MIN} characters`,
    )
    .max(
      POST_BODY_MAX,
      `Post body must be at most ${POST_BODY_MAX} characters`,
    ),
  streamerId: z.coerce.number().int().positive().optional(),
});
export class CreatePostDto extends createZodDto(CreatePostSchema) {}

export const ListPostsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().min(1).max(256).optional(),
});
export class ListPostsQueryDto extends createZodDto(ListPostsQuerySchema) {}
