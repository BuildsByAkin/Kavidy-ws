import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email();

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(20)
  .regex(
    /^[a-zA-Z0-9_]+$/,
    'Username may only contain letters, numbers, and underscores',
  );

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters');

const dateOfBirthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format');

const stateSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'State must be a 2-letter US state code');

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Country must be a 2-letter ISO code')
  .default('US');

export const SignupSchema = z.object({
  email: emailSchema,
  username: usernameSchema,
  password: passwordSchema,
  dateOfBirth: dateOfBirthSchema,
  state: stateSchema,
  country: countrySchema.optional(),
  rememberMe: z.boolean().optional(),
});
export class SignupDto extends createZodDto(SignupSchema) {}

export const LoginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional(),
});
export class LoginDto extends createZodDto(LoginSchema) {}

export const GoogleSchema = z.object({
  idToken: z.string().min(10),
  username: usernameSchema.optional(),
  rememberMe: z.boolean().optional(),
});
export class GoogleDto extends createZodDto(GoogleSchema) {}

export const RefreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});
export class RefreshDto extends createZodDto(RefreshSchema) {}

export const LogoutSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});
export class LogoutDto extends createZodDto(LogoutSchema) {}

export const ForgotPasswordSchema = z.object({
  email: emailSchema,
});
export class ForgotPasswordDto extends createZodDto(ForgotPasswordSchema) {}

export const ResetPasswordSchema = z.object({
  token: z.string().min(10).max(256),
  password: passwordSchema,
});
export class ResetPasswordDto extends createZodDto(ResetPasswordSchema) {}

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});
export class ChangePasswordDto extends createZodDto(ChangePasswordSchema) {}

export const OnboardSchema = z.object({
  dateOfBirth: dateOfBirthSchema,
  state: stateSchema,
  country: countrySchema.optional(),
});
export class OnboardDto extends createZodDto(OnboardSchema) {}
