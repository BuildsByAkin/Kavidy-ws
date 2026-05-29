import { randomBytes } from 'crypto';
import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env';

const REFRESH_COOKIE_PATH = '/v1/auth';

export interface AuthCookieContext {
  refreshCookieName: string;
  csrfCookieName: string;
  domain?: string;
  secure: boolean;
  csrfHeader: string;
}

export const CSRF_HEADER = 'x-csrf-token';
export const TOKEN_DELIVERY_HEADER = 'x-token-delivery';

export function authCookieContext(
  config: ConfigService<Env, true>,
): AuthCookieContext {
  const env = config.get('NODE_ENV', { infer: true });
  const explicitSecure = config.get('COOKIE_SECURE', { infer: true });
  return {
    refreshCookieName: config.get('REFRESH_COOKIE_NAME', { infer: true }),
    csrfCookieName: config.get('CSRF_COOKIE_NAME', { infer: true }),
    domain: config.get('COOKIE_DOMAIN', { infer: true }) || undefined,
    secure: explicitSecure ?? env === 'production',
    csrfHeader: CSRF_HEADER,
  };
}

function baseOptions(ctx: AuthCookieContext): CookieOptions {
  return {
    httpOnly: true,
    secure: ctx.secure,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    domain: ctx.domain,
  };
}

export function setRefreshCookie(
  res: Response,
  ctx: AuthCookieContext,
  token: string,
  options: { rememberMe: boolean; expiresAt: Date },
): void {
  const opts: CookieOptions = baseOptions(ctx);
  if (options.rememberMe) {
    opts.expires = options.expiresAt;
  }
  res.cookie(ctx.refreshCookieName, token, opts);

  const csrf = randomBytes(32).toString('base64url');
  res.cookie(ctx.csrfCookieName, csrf, {
    httpOnly: false,
    secure: ctx.secure,
    sameSite: 'lax',
    path: '/',
    domain: ctx.domain,
    ...(options.rememberMe ? { expires: options.expiresAt } : {}),
  });
}

export function clearAuthCookies(res: Response, ctx: AuthCookieContext): void {
  res.clearCookie(ctx.refreshCookieName, {
    ...baseOptions(ctx),
  });
  res.clearCookie(ctx.csrfCookieName, {
    httpOnly: false,
    secure: ctx.secure,
    sameSite: 'lax',
    path: '/',
    domain: ctx.domain,
  });
}

function getCookies(req: Request): Record<string, string> {
  const cookies = (req as Request & { cookies?: Record<string, string> })
    .cookies;
  return cookies ?? {};
}

export function readRefreshCookie(
  req: Request,
  ctx: AuthCookieContext,
): string | undefined {
  return getCookies(req)[ctx.refreshCookieName];
}

export function readCsrfCookie(
  req: Request,
  ctx: AuthCookieContext,
): string | undefined {
  return getCookies(req)[ctx.csrfCookieName];
}
