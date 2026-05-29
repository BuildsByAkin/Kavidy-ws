import {
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import { StreamersController } from './streamers.controller';
import { StreamersService } from './streamers.service';

describe('StreamersController', () => {
  let app: INestApplication;
  let svc: { search: jest.Mock };

  const currentUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'a@b.com',
    role: 'user',
    sessionId: '11111111-1111-4111-8111-111111111111',
  };

  beforeEach(async () => {
    svc = {
      search: jest.fn().mockResolvedValue([
        {
          id: 7,
          handle: 'xqc',
          displayName: 'xQc',
          platform: 'twitch',
          avatarUrl: null,
          active: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    };

    const mod = await Test.createTestingModule({
      controllers: [StreamersController],
      providers: [
        { provide: StreamersService, useValue: svc },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
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

  it('GET /v1/streamers returns matches with default limit', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/streamers')
      .query({ q: 'xq' })
      .expect(200);

    expect(svc.search).toHaveBeenCalledWith({ q: 'xq', limit: 10 });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: 7,
      handle: 'xqc',
      displayName: 'xQc',
      platform: 'twitch',
      avatarUrl: null,
    });
  });

  it('GET /v1/streamers without q is allowed (returns top streamers)', async () => {
    await request(app.getHttpServer()).get('/v1/streamers').expect(200);
    expect(svc.search).toHaveBeenCalledWith({ q: undefined, limit: 10 });
  });

  it('GET /v1/streamers honors limit', async () => {
    await request(app.getHttpServer())
      .get('/v1/streamers')
      .query({ q: 'x', limit: '5' })
      .expect(200);
    expect(svc.search).toHaveBeenCalledWith({ q: 'x', limit: 5 });
  });

  it('GET /v1/streamers rejects limit > 25', async () => {
    await request(app.getHttpServer())
      .get('/v1/streamers')
      .query({ limit: '100' })
      .expect(422);
  });
});
