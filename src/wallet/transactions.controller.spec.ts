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
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

describe('TransactionsController', () => {
  let app: INestApplication;
  let svc: { list: jest.Mock; exportCsv: jest.Mock };

  const currentUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'a@b.com',
    role: 'user',
    sessionId: '11111111-1111-4111-8111-111111111111',
  };

  beforeEach(async () => {
    svc = {
      list: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'r1',
            kind: 'purchase',
            category: 'top_ups',
            title: 'Coin package purchase',
            subtitle: 'Top-up',
            timestamp: '2025-01-10T12:00:01.000Z',
            amountCents: 5000,
            currency: 'sweeps_locked',
            status: 'completed',
          },
        ],
        nextCursor: null,
      }),
      exportCsv: jest
        .fn()
        .mockResolvedValue(
          'id,kind,category,title,subtitle,timestamp,amount_cents,currency,status\nr1,purchase,top_ups,Coin,Top-up,2025-01-10T12:00:01.000Z,5000,sweeps_locked,completed\n',
        ),
    };

    const mod = await Test.createTestingModule({
      controllers: [TransactionsController],
      providers: [
        { provide: TransactionsService, useValue: svc },
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

  it('GET /v1/wallet/transactions returns paginated list with defaults', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/wallet/transactions')
      .expect(200);

    expect(svc.list).toHaveBeenCalledWith({
      userId: currentUser.id,
      filter: 'all',
      limit: 25,
      cursor: undefined,
    });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].amountCents).toBe(5000);
    expect(res.body.nextCursor).toBeNull();
  });

  it('GET /v1/wallet/transactions accepts filter, limit and cursor', async () => {
    await request(app.getHttpServer())
      .get('/v1/wallet/transactions')
      .query({ filter: 'wins', limit: '10', cursor: 'abc' })
      .expect(200);

    expect(svc.list).toHaveBeenCalledWith({
      userId: currentUser.id,
      filter: 'wins',
      limit: 10,
      cursor: 'abc',
    });
  });

  it('GET /v1/wallet/transactions rejects invalid filter', async () => {
    await request(app.getHttpServer())
      .get('/v1/wallet/transactions')
      .query({ filter: 'nope' })
      .expect(422);
  });

  it('GET /v1/wallet/transactions rejects limit > 100', async () => {
    await request(app.getHttpServer())
      .get('/v1/wallet/transactions')
      .query({ limit: '500' })
      .expect(422);
  });

  it('GET /v1/wallet/transactions/export returns CSV with proper headers', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/wallet/transactions/export')
      .expect(200);

    expect(svc.exportCsv).toHaveBeenCalledWith({
      userId: currentUser.id,
      filter: 'all',
    });
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="kavidy-transactions-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.text).toContain(
      'id,kind,category,title,subtitle,timestamp,amount_cents,currency,status',
    );
    expect(res.text).toContain('r1,purchase,top_ups');
  });

  it('GET /v1/wallet/transactions/export honors filter param', async () => {
    await request(app.getHttpServer())
      .get('/v1/wallet/transactions/export')
      .query({ filter: 'picks' })
      .expect(200);
    expect(svc.exportCsv).toHaveBeenCalledWith({
      userId: currentUser.id,
      filter: 'picks',
    });
  });
});
