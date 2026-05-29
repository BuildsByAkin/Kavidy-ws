import {
  ExecutionContext,
  INestApplication,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let app: INestApplication;
  let users: { findById: jest.Mock };

  const userRow = {
    id: 'u1',
    email: 'jane@example.com',
    username: 'jane',
    passwordHash: null,
    emailVerified: true,
    emailVerifiedAt: new Date('2025-01-01T00:00:00Z'),
    status: 'active',
    role: 'user',
    displayName: 'Jane',
    avatarUrl: null,
    dateOfBirth: '1990-01-01',
    country: 'US',
    state: 'CA',
    lastLoginAt: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };

  beforeEach(async () => {
    users = { findById: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: users }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          const req = ctx.switchToHttp().getRequest();
          req.user = { id: 'u1', email: 'jane@example.com', role: 'user' };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /v1/users/me returns the authenticated user', async () => {
    users.findById.mockResolvedValue(userRow);
    const res = await request(app.getHttpServer())
      .get('/v1/users/me')
      .expect(200);
    expect(res.body.id).toBe('u1');
    expect(res.body.email).toBe('jane@example.com');
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('GET /v1/users/me returns 404 when user no longer exists', async () => {
    users.findById.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/v1/users/me').expect(404);
  });
});
