import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  VersioningType,
} from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkerApiKeyGuard } from '../common/guards/worker-api-key.guard';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import type { BetEntryRow } from '../database/schema/bet-entries';
import type { BetPickRow } from '../database/schema/bet-picks';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { BetsController } from './bets.controller';
import { BetsService } from './bets.service';
import { BetsSettlementService } from './bets.settlement.service';

const ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const MARKET_ID = 'streamer:plays_slots:abc1';

const currentUser = {
  id: USER_ID,
  email: 'user@test.com',
  role: 'user',
  sessionId: '33333333-3333-4333-8333-333333333333',
};

function makeEntry(overrides: Partial<BetEntryRow> = {}): BetEntryRow {
  return {
    id: ENTRY_ID,
    userId: USER_ID,
    status: 'pending',
    currency: 'sweeps_cashable',
    pickCount: 3,
    stakeAmountCents: 500,
    payoutMultiplierX100: 500,
    potentialPayoutCents: 2500,
    actualPayoutCents: null,
    idempotencyKey: 'test-key',
    settledAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    updatedAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

function makePick(): BetPickRow {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    entryId: ENTRY_ID,
    marketId: MARKET_ID,
    direction: 'yes',
    status: 'pending',
    marketQuestion: 'Will something happen?',
    marketResolvedStatus: null,
    resolvedAt: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };
}

function makeUser() {
  return {
    id: USER_ID,
    email: 'user@test.com',
    country: 'US',
    state: 'TX',
    role: 'user',
    status: 'active',
    onboardingStatus: 'active',
    username: 'testuser',
    passwordHash: null,
    emailVerified: true,
    emailVerifiedAt: null,
    displayName: null,
    avatarUrl: null,
    dateOfBirth: null,
    lastLoginAt: null,
    notificationPrefs: { emailDigest: true, marketAlerts: true },
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

describe('BetsController', () => {
  let app: INestApplication;

  let betsSvc: {
    placeEntry: jest.Mock;
    listEntries: jest.Mock;
    findEntryById: jest.Mock;
  };
  let settlementSvc: { settlePicksForMarket: jest.Mock };
  let usersSvc: { findById: jest.Mock };
  let walletSvc: { assertMoneyActionAllowed: jest.Mock };

  async function makeApp(opts: { userAuthed?: boolean; workerAuthed?: boolean } = {}) {
    const { userAuthed = true, workerAuthed = true } = opts;

    const mod = await Test.createTestingModule({
      controllers: [BetsController],
      providers: [
        { provide: BetsService, useValue: betsSvc },
        { provide: BetsSettlementService, useValue: settlementSvc },
        { provide: UsersService, useValue: usersSvc },
        { provide: WalletService, useValue: walletSvc },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!userAuthed) return false;
          ctx.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .overrideGuard(WorkerApiKeyGuard)
      .useValue({ canActivate: () => workerAuthed })
      .compile();

    const a = mod.createNestApplication();
    a.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await a.init();
    return a;
  }

  beforeEach(() => {
    betsSvc = {
      placeEntry: jest.fn().mockResolvedValue({ entry: makeEntry(), picks: [makePick()] }),
      listEntries: jest.fn().mockResolvedValue({ items: [{ entry: makeEntry(), picks: [makePick()] }], nextCursor: null }),
      findEntryById: jest.fn().mockResolvedValue({ entry: makeEntry(), picks: [makePick()] }),
    };
    settlementSvc = {
      settlePicksForMarket: jest.fn().mockResolvedValue(undefined),
    };
    usersSvc = {
      findById: jest.fn().mockResolvedValue(makeUser()),
    };
    walletSvc = {
      assertMoneyActionAllowed: jest.fn(),
    };
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  describe('POST /v1/bets/entries', () => {
    const validBody = {
      picks: [
        { marketId: 'market:a:001', direction: 'yes' },
        { marketId: 'market:b:002', direction: 'no' },
        { marketId: 'market:c:003', direction: 'yes' },
      ],
      stakeAmountCents: 500,
    };

    it('places an entry and returns 201 with idempotency key header', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .set('idempotency-key', 'test-key-abc-001')
        .send(validBody)
        .expect(201);

      expect(betsSvc.placeEntry).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({
          stakeAmountCents: 500,
          idempotencyKey: 'test-key-abc-001',
        }),
      );
      expect(res.body.id).toBe(ENTRY_ID);
      expect(res.body.picks).toHaveLength(1);
      expect(res.body.multiplierDisplay).toBe('5.00x');
    });

    it('returns 400 when idempotency-key header is missing', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .send(validBody)
        .expect(400);

      expect(betsSvc.placeEntry).not.toHaveBeenCalled();
    });

    it('returns 422 when fewer than 3 picks are provided', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .set('idempotency-key', 'test-key-abc-001')
        .send({
          picks: [
            { marketId: 'market:a', direction: 'yes' },
            { marketId: 'market:b', direction: 'no' },
          ],
          stakeAmountCents: 500,
        })
        .expect(422);
    });

    it('returns 422 when stake is below minimum', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .set('idempotency-key', 'test-key-abc-001')
        .send({ ...validBody, stakeAmountCents: 50 })
        .expect(422);
    });

    it('returns 422 when stake is above maximum', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .set('idempotency-key', 'test-key-abc-001')
        .send({ ...validBody, stakeAmountCents: 99_999 })
        .expect(422);
    });

    it('returns 404 when user is not found', async () => {
      app = await makeApp();
      usersSvc.findById.mockResolvedValue(null);
      await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .set('idempotency-key', 'test-key-abc-001')
        .send(validBody)
        .expect(404);
    });

    it('returns 401 when not authenticated', async () => {
      app = await makeApp({ userAuthed: false });
      await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .set('idempotency-key', 'test-key-abc-001')
        .send(validBody)
        .expect(403);
    });

    it('propagates ConflictException from service as 409', async () => {
      app = await makeApp();
      betsSvc.placeEntry.mockRejectedValue(
        new (require('@nestjs/common').ConflictException)('Market not open'),
      );
      await request(app.getHttpServer())
        .post('/v1/bets/entries')
        .set('idempotency-key', 'test-key-abc-001')
        .send(validBody)
        .expect(409);
    });
  });

  describe('GET /v1/bets/entries', () => {
    it('returns paginated entry list', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .get('/v1/bets/entries')
        .expect(200);

      expect(betsSvc.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, limit: 20 }),
      );
      expect(res.body.items).toHaveLength(1);
      expect(res.body.nextCursor).toBeNull();
    });

    it('passes status filter to service', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .get('/v1/bets/entries')
        .query({ status: 'won' })
        .expect(200);

      expect(betsSvc.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'won' }),
      );
    });

    it('returns 422 for invalid status filter', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .get('/v1/bets/entries')
        .query({ status: 'invalid_status' })
        .expect(422);
    });

    it('returns 401 when not authenticated', async () => {
      app = await makeApp({ userAuthed: false });
      await request(app.getHttpServer())
        .get('/v1/bets/entries')
        .expect(403);
    });
  });

  describe('GET /v1/bets/entries/:id', () => {
    it('returns entry with picks', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .get(`/v1/bets/entries/${ENTRY_ID}`)
        .expect(200);

      expect(betsSvc.findEntryById).toHaveBeenCalledWith(ENTRY_ID, USER_ID);
      expect(res.body.id).toBe(ENTRY_ID);
      expect(res.body.picks).toHaveLength(1);
      expect(res.body.picks[0].direction).toBe('yes');
    });

    it('returns 404 when entry not found', async () => {
      app = await makeApp();
      betsSvc.findEntryById.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get(`/v1/bets/entries/${ENTRY_ID}`)
        .expect(404);
    });

    it('returns 400 for invalid UUID', async () => {
      app = await makeApp();
      await request(app.getHttpServer())
        .get('/v1/bets/entries/not-a-uuid')
        .expect(400);
    });
  });

  describe('GET /v1/bets/multipliers', () => {
    it('returns multiplier table with limits', async () => {
      app = await makeApp();
      const res = await request(app.getHttpServer())
        .get('/v1/bets/multipliers')
        .expect(200);

      expect(res.body.table).toBeDefined();
      expect(res.body.table['3']).toBe(500);
      expect(res.body.table['4']).toBe(1000);
      expect(res.body.minPicks).toBe(3);
      expect(res.body.maxPicks).toBe(6);
      expect(res.body.minStakeCents).toBe(100);
      expect(res.body.maxStakeCents).toBe(10000);
    });
  });

  describe('POST /v1/bets/admin/settle-market/:marketId', () => {
    it('triggers settlement with worker auth', async () => {
      app = await makeApp({ workerAuthed: true });
      const res = await request(app.getHttpServer())
        .post('/v1/bets/admin/settle-market/market:abc:001')
        .send({ marketFinalStatus: 'resolved_yes' })
        .expect(200);

      expect(settlementSvc.settlePicksForMarket).toHaveBeenCalledWith(
        'market:abc:001',
        'resolved_yes',
      );
      expect(res.body.settled).toBe(true);
    });

    it('returns 403 without worker auth', async () => {
      app = await makeApp({ workerAuthed: false });
      await request(app.getHttpServer())
        .post('/v1/bets/admin/settle-market/market:abc:001')
        .send({ marketFinalStatus: 'resolved_yes' })
        .expect(403);
    });
  });
});
