import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { Env } from '../../config/env';
import {
  authCookieContext,
  readCsrfCookie,
  readRefreshCookie,
} from '../cookies';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ctx = authCookieContext(this.config);

    const refreshCookie = readRefreshCookie(req, ctx);
    if (!refreshCookie) {
      return true;
    }

    const csrfCookie = readCsrfCookie(req, ctx);
    const headerValue = req.headers[ctx.csrfHeader];
    const csrfHeader = Array.isArray(headerValue)
      ? headerValue[0]
      : headerValue;

    if (!csrfCookie || !csrfHeader) {
      throw new ForbiddenException({
        code: 'CSRF_TOKEN_MISSING',
        message: 'CSRF token is required',
      });
    }
    if (!safeEqual(csrfCookie, csrfHeader)) {
      throw new ForbiddenException({
        code: 'CSRF_TOKEN_INVALID',
        message: 'CSRF token is invalid',
      });
    }
    return true;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
