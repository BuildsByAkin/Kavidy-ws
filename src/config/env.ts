import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  JWT_REFRESH_SHORT_TTL_HOURS: z.coerce.number().int().positive().default(12),
  JWT_REFRESH_ABSOLUTE_TTL_DAYS: z.coerce.number().int().positive().default(90),
  JWT_REFRESH_IDLE_TTL_DAYS: z.coerce.number().int().positive().default(14),

  REFRESH_COOKIE_NAME: z.string().min(1).default('kvd_rt'),
  CSRF_COOKIE_NAME: z.string().min(1).default('kvd_csrf'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z
    .union([z.boolean(), z.string()])
    .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'))
    .optional(),

  GOOGLE_CLIENT_IDS: z
    .string()
    .min(1)
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),

  PASSWORD_RESET_URL: z
    .string()
    .url()
    .default('http://localhost:5173/reset-password'),

  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    ),

  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),

  MARKETS_WORKER_API_KEY: z.string().min(32),

  PAYMENT_SUCCESS_URL: z
    .string()
    .url()
    .default('http://localhost:5173/wallet?status=success'),
  PAYMENT_CANCEL_URL: z
    .string()
    .url()
    .default('http://localhost:5173/wallet?status=cancelled'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return parsed.data;
}
