import * as http from 'http';
import type { AddressInfo } from 'net';
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import { Subject } from 'rxjs';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import { WorkerApiKeyGuard } from '../common/guards/worker-api-key.guard';
import type { MarketRow } from '../database/schema/markets';
import { MarketsEventsService } from './markets-events.service';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';

function sseHeaders(server: http.Server, path: string): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.get({ hostname: '127.0.0.1', port, path }, (res) => {
      resolve(res);
      res.destroy();
      req.destroy();
    });
    req.on('error', reject);
  });
}

const OPENS_AT = new Date('2026-06-03T18:00:00Z');
const RESOLVES_AT = new Date('2026-06-04T18:00:00Z');
const GENERATED_AT = new Date('2026-06-03T17:58:00Z');
const CREATED_AT = new Date('2026-06-01T00:00:00Z');

function sampleRow(overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    id: 'asmongold:reacts_patch_notes:4a9f',
    creatorId: 'asmongold',
    creatorDisplayName: 'Asmongold',
    creatorPrimaryPlatform: 'twitch',
    question: 'Will Asmongold react to the new WoW patch today?',
    kind: 'reacts_patch_notes',
    status: 'open',
    confidenceLevel: 'medium',
    opensAt: OPENS_AT,
    resolvesAt: RESOLVES_AT,
    generatedAt: GENERATED_AT,
    resolvedAt: null,
    evidence: [],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function validUpsertBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'asmongold:reacts_patch_notes:4a9f',
    creator_id: 'asmongold',
    creator_display_name: 'Asmongold',
    creator_primary_platform: 'twitch',
    question: 'Will Asmongold react to the new WoW patch today?',
    kind: 'reacts_patch_notes',
    status: 'open',
    confidence_level: 'medium',
    opens_at: OPENS_AT,
    resolves_at: RESOLVES_AT,
    generated_at: GENERATED_AT,
    resolved_at: null,
    evidence: [],
    ...overrides,
  };
}

const currentUser = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'a@b.com',
  role: 'user',
  sessionId: '11111111-1111-4111-8111-111111111111',
};

describe('MarketsController', () => {
  let app: INestApplication;
  let svc: {
    upsert: jest.Mock;
    upsertBulk: jest.Mock;
    list: jest.Mock;
    findById: jest.Mock;
    findByIdOrThrow: jest.Mock;
  };
  let eventsSubject: Subject<any>;

  async function makeApp(opts: { workerAuthed?: boolean; userAuthed?: boolean } = {}) {
    const { workerAuthed = true, userAuthed = true } = opts;

    eventsSubject = new Subject();
    const mockEventsService = {
      emit: jest.fn(),
      events$: eventsSubject.asObservable(),
    };

    const mod = await Test.createTestingModule({
      controllers: [MarketsController],
      providers: [
        { provide: MarketsService, useValue: svc },
        { provide: MarketsEventsService, useValue: mockEventsService },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    })
      .overrideGuard(WorkerApiKeyGuard)
      .useValue({
        canActivate: () => {
          if (!workerAuthed)
            throw new Error('Unauthorized');
          return true;
        },
      })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!userAuthed) return false;
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .compile();

    const a = mod.createNestApplication();
    a.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await a.init();
    return a;
  }

  beforeEach(() => {
    svc = {
      upsert: jest.fn().mockResolvedValue(sampleRow()),
      upsertBulk: jest.fn().mockResolvedValue({ upserted: 2, skipped: 0 }),
      list: jest.fn().mockResolvedValue({ items: [sampleRow()], nextCursor: null }),
      findById: jest.fn().mockResolvedValue(sampleRow()),
      findByIdOrThrow: jest.fn().mockResolvedValue(sampleRow()),
    };
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('POST /v1/markets/upsert', () => {
    it('upserts a market with a valid payload', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .post('/v1/markets/upsert')
        .send(validUpsertBody())
        .expect(200);

      expect(svc.upsert).toHaveBeenCalledTimes(1);
      expect(res.body.id).toBe('asmongold:reacts_patch_notes:4a9f');
      expect(res.body.status).toBe('open');
    });

    it('rejects a payload with invalid status', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/markets/upsert')
        .send(validUpsertBody({ status: 'invalid_status' }))
        .expect(422);
      expect(svc.upsert).not.toHaveBeenCalled();
    });

    it('rejects a payload with invalid platform', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/markets/upsert')
        .send(validUpsertBody({ creator_primary_platform: 'facebook' }))
        .expect(422);
    });

    it('rejects a payload missing required fields', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/markets/upsert')
        .send({ id: 'test:id' })
        .expect(422);
    });

    it('returns 409 when service throws ConflictException', async () => {
      app = await makeApp();
      svc.upsert.mockRejectedValue(
        new ConflictException('Market is in terminal status'),
      );
      await request(app.getHttpServer())
        .post('/v1/markets/upsert')
        .send(validUpsertBody())
        .expect(409);
    });

    it('accepts youtube as a valid platform', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/markets/upsert')
        .send(validUpsertBody({ creator_primary_platform: 'youtube' }))
        .expect(200);
    });
  });

  describe('POST /v1/markets/upsert-bulk', () => {
    it('upserts multiple markets', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .post('/v1/markets/upsert-bulk')
        .send({ markets: [validUpsertBody(), validUpsertBody({ id: 'other:id:abc' })] })
        .expect(200);

      expect(svc.upsertBulk).toHaveBeenCalledTimes(1);
      expect(res.body).toEqual({ upserted: 2, skipped: 0 });
    });

    it('rejects an empty markets array', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/markets/upsert-bulk')
        .send({ markets: [] })
        .expect(422);
    });

    it('rejects when markets array exceeds 100', async () => {
      app = await makeApp();
      const bigArray = Array.from({ length: 101 }, (_, i) =>
        validUpsertBody({ id: `market:${i}` }),
      );
      await request(app.getHttpServer())
        .post('/v1/markets/upsert-bulk')
        .send({ markets: bigArray })
        .expect(422);
    });
  });

  describe('GET /v1/markets', () => {
    it('returns paginated market list', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .get('/v1/markets')
        .expect(200);

      expect(svc.list).toHaveBeenCalledWith({
        status: undefined,
        creatorId: undefined,
        limit: 20,
        cursor: undefined,
      });
      expect(res.body.items).toHaveLength(1);
      expect(res.body.nextCursor).toBeNull();
    });

    it('passes status and creator_id filters to service', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .get('/v1/markets')
        .query({ status: 'open', creator_id: 'asmongold' })
        .expect(200);

      expect(svc.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'open', creatorId: 'asmongold' }),
      );
    });

    it('rejects limit > 100', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .get('/v1/markets')
        .query({ limit: 999 })
        .expect(422);
    });

    it('rejects invalid status filter', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .get('/v1/markets')
        .query({ status: 'not_a_status' })
        .expect(422);
    });

    it('is publicly accessible without auth', async () => {
      app = await makeApp({ userAuthed: false });
      await request(app.getHttpServer()).get('/v1/markets').expect(200);
    });
  });

  describe('GET /v1/markets/events (SSE)', () => {
    it('responds with text/event-stream content type', async () => {
      app = await makeApp();
      await app.listen(0);
      const res = await sseHeaders(app.getHttpServer(), '/v1/markets/events');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    });

    it('is publicly accessible without auth', async () => {
      app = await makeApp({ userAuthed: false });
      await app.listen(0);
      const res = await sseHeaders(app.getHttpServer(), '/v1/markets/events');
      expect(res.statusCode).toBe(200);
    });
  });

  describe('GET /v1/markets/:id', () => {
    it('returns the market by id', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .get('/v1/markets/asmongold:reacts_patch_notes:4a9f')
        .expect(200);

      expect(svc.findById).toHaveBeenCalledWith(
        'asmongold:reacts_patch_notes:4a9f',
      );
      expect(res.body.id).toBe('asmongold:reacts_patch_notes:4a9f');
    });

    it('returns 404 when market not found', async () => {
      app = await makeApp();
      svc.findById.mockResolvedValue(null as unknown as MarketRow);
      await request(app.getHttpServer())
        .get('/v1/markets/nonexistent:id')
        .expect(404);
    });

    it('is publicly accessible without auth', async () => {
      app = await makeApp({ userAuthed: false });
      await request(app.getHttpServer())
        .get('/v1/markets/asmongold:reacts_patch_notes:4a9f')
        .expect(200);
    });
  });
});
