import { INestApplication, VersioningType } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let app: INestApplication;
  let auth: { [K in keyof AuthService]: jest.Mock };

  const tokenPair = {
    accessToken: 'access',
    refreshToken: 'refresh',
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
    profileComplete: true,
    createdAt: '2030-01-01T00:00:00.000Z',
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
      completeProfile: jest.fn().mockResolvedValue(publicUser),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /v1/auth/signup', () => {
    it('returns 201 with tokens on success', async () => {
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
      expect(auth.signup).toHaveBeenCalled();
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
    it('returns 200 with tokens', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ email: 'jane@example.com', password: 'whatever' })
        .expect(200);
      expect(auth.login).toHaveBeenCalled();
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
    it('returns 200 with new tokens', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'rid.secretvalue' })
        .expect(200);
      expect(auth.refresh).toHaveBeenCalledWith(
        'rid.secretvalue',
        expect.any(Object),
      );
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('returns 204', async () => {
      await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .send({ refreshToken: 'rid.secretvalue' })
        .expect(204);
      expect(auth.logout).toHaveBeenCalledWith('rid.secretvalue');
    });
  });
});
