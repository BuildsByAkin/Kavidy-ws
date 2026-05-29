import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { UsersService } from '../users/users.service';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfGuard } from './guards/csrf.guard';
import { TokensService } from './tokens.service';

const REFRESH_COOKIE = 'kvd_rt';
const CSRF_COOKIE = 'kvd_csrf';

function parseCookies(setCookie: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of setCookie ?? []) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return out;
}

describe('AuthController', () => {
  let app: INestApplication;
  let auth: { [K in keyof AuthService]: jest.Mock };

  const tokenPair = {
    accessToken: 'access',
    refreshToken: 'rid.secret',
    accessTokenExpiresAt: '2030-01-01T00:00:00.000Z',
    refreshTokenExpiresAt: '2030-01-01T00:00:00.000Z',
  };

  const publicUser = {
    id: 'u1',
    email: 'jane@example.com',
    username: 'jane',
    emailVerified: false,
    status: 'active',
    role: 'user',
    displayName: null,
    avatarUrl: null,
    dateOfBirth: '1990-01-01',
    country: 'US',
    state: 'CA',
    onboardingStatus: 'active',
    createdAt: '2030-01-01T00:00:00.000Z',
  };

  const configValues: Record<string, unknown> = {
    NODE_ENV: 'test',
    REFRESH_COOKIE_NAME: REFRESH_COOKIE,
    CSRF_COOKIE_NAME: CSRF_COOKIE,
    COOKIE_DOMAIN: undefined,
    COOKIE_SECURE: false,
  };

  beforeEach(async () => {
    auth = {
      signup: jest
        .fn()
        .mockResolvedValue({ user: publicUser, tokens: tokenPair }),
      login: jest
        .fn()
        .mockResolvedValue({ user: publicUser, tokens: tokenPair }),
      loginWithGoogle: jest
        .fn()
        .mockResolvedValue({ user: publicUser, tokens: tokenPair }),
      refresh: jest
        .fn()
        .mockResolvedValue({ user: publicUser, tokens: tokenPair }),
      logout: jest.fn().mockResolvedValue(undefined),
      requestPasswordReset: jest.fn().mockResolvedValue(undefined),
      confirmPasswordReset: jest.fn().mockResolvedValue(undefined),
      changePassword: jest.fn().mockResolvedValue(undefined),
      onboard: jest.fn().mockResolvedValue(publicUser),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: UsersService, useValue: { findById: jest.fn() } },
        {
          provide: TokensService,
          useValue: { isSessionActive: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: ConfigService,
          useValue: { get: (k: string) => configValues[k] },
        },
        CsrfGuard,
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/auth/signup', () => {
    it('returns 201, sets HttpOnly refresh cookie, omits refresh from body', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/signup')
        .send({
          email: 'jane@example.com',
          username: 'jane',
          password: 'longenough123',
          dateOfBirth: '1990-01-01',
          state: 'CA',
        })
        .expect(201);

      expect(res.body.user.email).toBe('jane@example.com');
      expect(res.body.tokens.accessToken).toBe('access');
      expect(res.body.tokens.refreshToken).toBeUndefined();

      const setCookie = res.headers['set-cookie'] as unknown as string[];
      expect(setCookie.some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(
        true,
      );
      expect(setCookie.some((c) => c.startsWith(`${CSRF_COOKIE}=`))).toBe(true);
      const rt = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
      expect(rt).toMatch(/HttpOnly/i);
      expect(rt).toMatch(/SameSite=Lax/i);
      expect(rt).toMatch(/Path=\/v1\/auth/i);
      const csrf = setCookie.find((c) => c.startsWith(`${CSRF_COOKIE}=`))!;
      expect(csrf).not.toMatch(/HttpOnly/i);
    });

    it('rejects invalid email with 422', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/signup')
        .send({
          email: 'not-an-email',
          username: 'jane',
          password: 'longenough123',
        })
        .expect(422);
      expect(res.body.error).toBe('ValidationError');
    });

    it('rejects short password with 422', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/signup')
        .send({ email: 'a@b.com', username: 'jane', password: 'short' })
        .expect(422);
    });

    it('rejects bad username with 422', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/signup')
        .send({
          email: 'a@b.com',
          username: 'has spaces',
          password: 'longenough123',
        })
        .expect(422);
    });
  });

  describe('POST /v1/auth/login', () => {
    it('returns 200, sets cookies, omits refresh token from body (web)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'jane@example.com', password: 'whatever' })
        .expect(200);
      expect(auth.login).toHaveBeenCalled();
      expect(res.body.tokens.refreshToken).toBeUndefined();
      const cookies = parseCookies(
        res.headers['set-cookie'] as unknown as string[],
      );
      expect(cookies[REFRESH_COOKIE]).toBe('rid.secret');
      expect(cookies[CSRF_COOKIE]).toBeTruthy();
    });

    it('returns refresh token in body and skips cookie when X-Token-Delivery: body', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .set('X-Token-Delivery', 'body')
        .send({ email: 'jane@example.com', password: 'whatever' })
        .expect(200);
      expect(res.body.tokens.refreshToken).toBe('rid.secret');
      const setCookie =
        (res.headers['set-cookie'] as unknown as string[]) ?? [];
      expect(setCookie.some((c) => c.startsWith(`${REFRESH_COOKIE}=`))).toBe(
        false,
      );
    });

    it('uses session cookie (no Expires) when rememberMe=false', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({
          email: 'jane@example.com',
          password: 'whatever',
          rememberMe: false,
        })
        .expect(200);
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const rt = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
      expect(rt).not.toMatch(/Expires=/i);
      expect(rt).not.toMatch(/Max-Age=/i);
    });

    it('passes rememberMe=true through to AuthService when set', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({
          email: 'jane@example.com',
          password: 'whatever',
          rememberMe: true,
        })
        .expect(200);
      expect(auth.login).toHaveBeenCalledWith(
        expect.objectContaining({ rememberMe: true }),
        expect.any(Object),
      );
    });
  });

  describe('POST /v1/auth/google', () => {
    it('returns 200 with tokens', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/google')
        .send({ idToken: 'some.id.token.value' })
        .expect(200);
      expect(auth.loginWithGoogle).toHaveBeenCalled();
    });

    it('rejects missing idToken with 422', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/google')
        .send({})
        .expect(422);
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('reads refresh token from cookie when CSRF matches', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('Cookie', [
          `${REFRESH_COOKIE}=rid.secretvalue`,
          `${CSRF_COOKIE}=abc123`,
        ])
        .set('X-CSRF-Token', 'abc123')
        .send({})
        .expect(200);
      expect(auth.refresh).toHaveBeenCalledWith(
        'rid.secretvalue',
        expect.any(Object),
      );
    });

    it('returns 400 when no token in body or cookie', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({})
        .expect(400);
    });

    it('returns 403 when cookie present but CSRF header is missing', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('Cookie', [`${REFRESH_COOKIE}=rid.x`, `${CSRF_COOKIE}=abc123`])
        .send({})
        .expect(403);
    });

    it('returns 403 when CSRF header does not match cookie', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .set('Cookie', [`${REFRESH_COOKIE}=rid.x`, `${CSRF_COOKIE}=abc123`])
        .set('X-CSRF-Token', 'wrong')
        .send({})
        .expect(403);
    });

    it('accepts body refresh token without CSRF (no cookie auth in use)', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'rid.fromBody' })
        .expect(200);
      expect(auth.refresh).toHaveBeenCalledWith(
        'rid.fromBody',
        expect.any(Object),
      );
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('clears cookies and revokes token when cookie + CSRF provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Cookie', [
          `${REFRESH_COOKIE}=rid.secretvalue`,
          `${CSRF_COOKIE}=abc123`,
        ])
        .set('X-CSRF-Token', 'abc123')
        .send({})
        .expect(204);
      expect(auth.logout).toHaveBeenCalledWith('rid.secretvalue');
      const setCookie = res.headers['set-cookie'] as unknown as string[];
      const rt = setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE}=`))!;
      expect(rt).toMatch(/Expires=Thu, 01 Jan 1970/i);
    });

    it('returns 204 even with no token (idempotent)', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .send({})
        .expect(204);
      expect(auth.logout).not.toHaveBeenCalled();
    });
  });
});
