import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Display name must be at least 2 characters')
  .max(32, 'Display name must be at most 32 characters')
  .regex(
    /^[a-zA-Z0-9_\- ]+$/,
    'Display name may only contain letters, numbers, spaces, underscores, and dashes',
  );

export const UpdateDisplayNameSchema = z.object({
  displayName: displayNameSchema,
});
export class UpdateDisplayNameDto extends createZodDto(
  UpdateDisplayNameSchema,
) {}

export const UpdateEmailSchema = z.object({
  email: z.string().trim().toLowerCase().min(3).max(254).email(),
});
export class UpdateEmailDto extends createZodDto(UpdateEmailSchema) {}

export const UpdateNotificationPrefsSchema = z
  .object({
    emailDigest: z.boolean().optional(),
    marketAlerts: z.boolean().optional(),
  })
  .refine(
    (v) => v.emailDigest !== undefined || v.marketAlerts !== undefined,
    'At least one preference must be provided',
  );
export class UpdateNotificationPrefsDto extends createZodDto(
  UpdateNotificationPrefsSchema,
) {}

export const DeleteAccountSchema = z.object({
  confirmHandle: z.string().trim().min(1),
});
export class DeleteAccountDto extends createZodDto(DeleteAccountSchema) {}
