import {
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TokensService } from '../auth/tokens.service';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import {
  AdminSessionsController,
  SessionsController,
} from './sessions.controller';

function makeRefreshRow(overrides: any = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    familyId: '33333333-3333-4333-8333-333333333333',
    tokenHash: 'h',
    issuedAt: new Date('2025-01-01'),
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    replacedById: null,
    userAgent: 'jest',
    ipAddress: '127.0.0.1',
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

describe('SessionsController (user)', () => {
  let app: INestApplication;
  let tokens: any;

  const currentUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'a@b.com',
    role: 'user',
    sessionId: '11111111-1111-4111-8111-111111111111',
  };

  beforeEach(async () => {
    tokens = {
      listSessionsForUser: jest.fn().mockResolvedValue([makeRefreshRow()]),
      revokeSessionById: jest.fn().mockResolvedValue(true),
      revokeAllForUser: jest.fn().mockResolvedValue(0),
    };

    const mod = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [
        { provide: TokensService, useValue: tokens },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();

    app = mod.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /v1/sessions/me lists sessions and marks current', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/sessions/me')
      .expect(200);
    expect(res.body.sessions[0].current).toBe(true);
    expect(res.body.sessions[0].active).toBe(true);
  });

  it('DELETE /v1/sessions/me/:id revokes scoped to the user', async () => {
    await request(app.getHttpServer())
      .delete('/v1/sessions/me/11111111-1111-4111-8111-111111111111')
      .expect(204);
    expect(tokens.revokeSessionById).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      currentUser.id,
    );
  });

  it('DELETE /v1/sessions/me/:id returns 404 when revoke fails', async () => {
    tokens.revokeSessionById.mockResolvedValue(false);
    await request(app.getHttpServer())
      .delete('/v1/sessions/me/11111111-1111-4111-8111-111111111111')
      .expect(404);
  });

  it('DELETE /v1/sessions/me revokes all except current', async () => {
    await request(app.getHttpServer()).delete('/v1/sessions/me').expect(204);
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(
      currentUser.id,
      currentUser.sessionId,
    );
  });
});

describe('AdminSessionsController', () => {
  let app: INestApplication;
  let tokens: any;

  function buildApp(role: 'admin' | 'user') {
    const user = {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'admin@kavidy.test',
      role,
    };
    tokens = {
      listSessionsForUser: jest.fn().mockResolvedValue([makeRefreshRow()]),
      revokeSessionById: jest.fn().mockResolvedValue(true),
      revokeAllForUser: jest.fn().mockResolvedValue(3),
    };
    return Test.createTestingModule({
      controllers: [AdminSessionsController],
      providers: [
        Reflector,
        RolesGuard,
        { provide: TokensService, useValue: tokens },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = user;
          return true;
        },
      })
      .compile()
      .then(async (mod) => {
        const a = mod.createNestApplication();
        a.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await a.init();
        return a;
      });
  }

  afterEach(async () => {
    if (app) await app.close();
  });

  it('admin can list sessions for any user', async () => {
    app = await buildApp('admin');
    const res = await request(app.getHttpServer())
      .get('/v1/admin/users/22222222-2222-4222-8222-222222222222/sessions')
      .expect(200);
    expect(res.body.sessions).toHaveLength(1);
  });

  it('non-admin is forbidden', async () => {
    app = await buildApp('user');
    await request(app.getHttpServer())
      .get('/v1/admin/users/22222222-2222-4222-8222-222222222222/sessions')
      .expect(403);
  });

  it('admin can revoke a specific session for a user', async () => {
    app = await buildApp('admin');
    await request(app.getHttpServer())
      .delete(
        '/v1/admin/users/22222222-2222-4222-8222-222222222222/sessions/11111111-1111-4111-8111-111111111111',
      )
      .expect(204);
    expect(tokens.revokeSessionById).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('admin can revoke all sessions for a user', async () => {
    app = await buildApp('admin');
    await request(app.getHttpServer())
      .delete('/v1/admin/users/22222222-2222-4222-8222-222222222222/sessions')
      .expect(204);
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
    );
  });
});
