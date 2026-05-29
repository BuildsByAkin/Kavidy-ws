import {
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ZodValidationPipe } from 'nestjs-zod';
import { APP_PIPE } from '@nestjs/core';
import { ZodHttpExceptionFilter } from '../common/filters/zod-http-exception.filter';
import { APP_FILTER } from '@nestjs/core';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { LedgerService } from '../wallet/ledger.service';
import { AccountService } from './account.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let app: INestApplication;
  let users: { findById: jest.Mock };
  let ledger: { ensureBalanceRow: jest.Mock; getBalance: jest.Mock };
  let account: {
    updateDisplayName: jest.Mock;
    updateEmail: jest.Mock;
    updateNotificationPrefs: jest.Mock;
    deleteAccount: jest.Mock;
  };

  const userRow = {
    id: 'u1',
    email: 'jane@example.com',
    username: 'jane',
    passwordHash: null,
    emailVerified: true,
    emailVerifiedAt: new Date('2025-01-01T00:00:00Z'),
    status: 'active',
    role: 'user',
    onboardingStatus: 'active',
    displayName: 'Jane',
    avatarUrl: null,
    dateOfBirth: '1990-01-01',
    country: 'US',
    state: 'CA',
    lastLoginAt: null,
    notificationPrefs: { emailDigest: true, marketAlerts: true },
    deletedAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  const balanceSnapshot = {
    sweepsCashableCents: 0,
    sweepsLockedCents: 0,
    sweepsTotalCents: 0,
  };

  const publicUser = {
    id: 'u1',
    email: 'jane@example.com',
    username: 'jane',
    emailVerified: true,
    status: 'active',
    role: 'user',
    onboardingStatus: 'active',
    displayName: 'Jane',
    avatarUrl: null,
    dateOfBirth: '1990-01-01',
    country: 'US',
    state: 'CA',
    notificationPrefs: { emailDigest: true, marketAlerts: true },
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    users = { findById: jest.fn() };
    ledger = {
      ensureBalanceRow: jest.fn().mockResolvedValue(undefined),
      getBalance: jest.fn().mockResolvedValue(balanceSnapshot),
    };
    account = {
      updateDisplayName: jest.fn(),
      updateEmail: jest.fn(),
      updateNotificationPrefs: jest.fn(),
      deleteAccount: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: LedgerService, useValue: ledger },
        { provide: AccountService, useValue: account },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              switch (key) {
                case 'NODE_ENV':
                  return 'test';
                case 'REFRESH_COOKIE_NAME':
                  return 'kvd_rt';
                case 'CSRF_COOKIE_NAME':
                  return 'kvd_csrf';
                case 'COOKIE_DOMAIN':
                  return '';
                case 'COOKIE_SECURE':
                  return false;
                default:
                  return undefined;
              }
            },
          },
        },
        { provide: APP_PIPE, useClass: ZodValidationPipe },
        { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = {
            id: 'u1',
            email: 'jane@example.com',
            role: 'user',
            sessionId: 's1',
          };
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /v1/users/me returns the authenticated user with balances', async () => {
    users.findById.mockResolvedValue(userRow);
    const res = await request(app.getHttpServer())
      .get('/v1/users/me')
      .expect(200);
    expect(res.body.user.id).toBe('u1');
    expect(res.body.user.email).toBe('jane@example.com');
    expect(res.body.user.onboardingStatus).toBe('active');
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user.notificationPrefs).toEqual({
      emailDigest: true,
      marketAlerts: true,
    });
    expect(res.body.balances).toEqual(balanceSnapshot);
  });

  it('GET /v1/users/me returns 404 when user no longer exists', async () => {
    users.findById.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/v1/users/me').expect(404);
  });

  describe('PATCH /v1/users/me/profile', () => {
    it('updates display name', async () => {
      account.updateDisplayName.mockResolvedValue({
        ...publicUser,
        displayName: 'Jane Q',
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/users/me/profile')
        .send({ displayName: 'Jane Q' })
        .expect(200);
      expect(res.body.displayName).toBe('Jane Q');
      expect(account.updateDisplayName).toHaveBeenCalledWith('u1', 'Jane Q');
    });

    it('rejects empty display name', async () => {
      await request(app.getHttpServer())
        .patch('/v1/users/me/profile')
        .send({ displayName: '' })
        .expect(422);
      expect(account.updateDisplayName).not.toHaveBeenCalled();
    });

    it('rejects single-character display name', async () => {
      await request(app.getHttpServer())
        .patch('/v1/users/me/profile')
        .send({ displayName: 'J' })
        .expect(422);
      expect(account.updateDisplayName).not.toHaveBeenCalled();
    });

    it('rejects missing displayName field', async () => {
      await request(app.getHttpServer())
        .patch('/v1/users/me/profile')
        .send({})
        .expect(422);
    });
  });

  describe('PATCH /v1/users/me/email', () => {
    it('updates email', async () => {
      account.updateEmail.mockResolvedValue({
        ...publicUser,
        email: 'new@example.com',
        emailVerified: false,
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/users/me/email')
        .send({ email: 'new@example.com' })
        .expect(200);
      expect(res.body.email).toBe('new@example.com');
      expect(res.body.emailVerified).toBe(false);
      expect(account.updateEmail).toHaveBeenCalledWith('u1', 'new@example.com');
    });

    it('rejects invalid email format', async () => {
      await request(app.getHttpServer())
        .patch('/v1/users/me/email')
        .send({ email: 'not-an-email' })
        .expect(422);
      expect(account.updateEmail).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /v1/users/me/notifications', () => {
    it('updates notification preferences', async () => {
      account.updateNotificationPrefs.mockResolvedValue({
        ...publicUser,
        notificationPrefs: { emailDigest: false, marketAlerts: true },
      });
      const res = await request(app.getHttpServer())
        .patch('/v1/users/me/notifications')
        .send({ emailDigest: false })
        .expect(200);
      expect(res.body.notificationPrefs.emailDigest).toBe(false);
      expect(account.updateNotificationPrefs).toHaveBeenCalledWith('u1', {
        emailDigest: false,
      });
    });

    it('rejects empty body', async () => {
      await request(app.getHttpServer())
        .patch('/v1/users/me/notifications')
        .send({})
        .expect(422);
    });

    it('rejects non-boolean values', async () => {
      await request(app.getHttpServer())
        .patch('/v1/users/me/notifications')
        .send({ emailDigest: 'yes' })
        .expect(422);
    });
  });

  describe('DELETE /v1/users/me', () => {
    it('deletes the account when handle is confirmed', async () => {
      account.deleteAccount.mockResolvedValue(undefined);
      await request(app.getHttpServer())
        .delete('/v1/users/me')
        .send({ confirmHandle: 'jane' })
        .expect(204);
      expect(account.deleteAccount).toHaveBeenCalledWith('u1', 'jane');
    });

    it('rejects empty confirmHandle', async () => {
      await request(app.getHttpServer())
        .delete('/v1/users/me')
        .send({ confirmHandle: '' })
        .expect(422);
      expect(account.deleteAccount).not.toHaveBeenCalled();
    });

    it('rejects missing confirmHandle', async () => {
      await request(app.getHttpServer())
        .delete('/v1/users/me')
        .send({})
        .expect(422);
    });
  });
});
