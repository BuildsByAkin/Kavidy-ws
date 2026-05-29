import { createHash } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DRIZZLE } from '../database/database.module';
import type { UserRow } from '../database/schema/users';
import { TokensService, parseDurationMs } from './tokens.service';

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '0190a000-0000-7000-8000-000000000001',
    email: 'user@example.com',
    username: 'user',
    passwordHash: null,
    emailVerified: false,
    emailVerifiedAt: null,
    status: 'active',
    role: 'user',
    displayName: null,
    avatarUrl: null,
    dateOfBirth: '1990-01-01',
    country: 'US',
    state: 'CA',
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface MockState {
  inserts: any[];
  updates: any[];
  selectResults: any[][];
}

function makeDb(state: MockState): any {
  return {
    insert: () => ({
      values: (v: any) => {
        state.inserts.push(v);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (patch: any) => ({
        where: (_clause: any) => {
          state.updates.push(patch);
          return Promise.resolve();
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: (_n: number) =>
            Promise.resolve(state.selectResults.shift() ?? []),
        }),
      }),
    }),
  };
}

async function buildService(state: MockState): Promise<TokensService> {
  const config = {
    get: (key: string) =>
      (
        ({
          JWT_ACCESS_SECRET: 'a'.repeat(40),
          JWT_REFRESH_SECRET: 'b'.repeat(40),
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_TTL_DAYS: 30,
        }) as Record<string, any>
      )[key],
  };
  const moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({})],
    providers: [
      TokensService,
      { provide: ConfigService, useValue: config },
      { provide: DRIZZLE, useValue: makeDb(state) },
    ],
  }).compile();
  return moduleRef.get(TokensService);
}

describe('parseDurationMs', () => {
  it('parses common units', () => {
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('1h')).toBe(3_600_000);
    expect(parseDurationMs('30d')).toBe(30 * 86_400_000);
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('45')).toBe(45_000);
  });
  it('rejects invalid', () => {
    expect(() => parseDurationMs('nope')).toThrow();
  });
});

describe('TokensService', () => {
  it('issues a token pair and persists a hashed refresh token', async () => {
    const state: MockState = { inserts: [], updates: [], selectResults: [] };
    const svc = await buildService(state);

    const user = makeUser();
    const pair = await svc.issueTokenPair(user, {
      userAgent: 'jest',
      ipAddress: '127.0.0.1',
    });

    expect(pair.accessToken.split('.')).toHaveLength(3);
    expect(pair.refreshToken).toMatch(/^[0-9a-f-]{36}\..+/i);
    expect(state.inserts).toHaveLength(1);

    const stored = state.inserts[0];
    const [, secret] = pair.refreshToken.split('.');
    expect(stored.tokenHash).toBe(
      createHash('sha256').update(secret).digest('hex'),
    );
    expect(stored.userId).toBe(user.id);
    expect(stored.userAgent).toBe('jest');
    expect(stored.familyId).toBeDefined();
    expect(stored.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects malformed refresh token', async () => {
    const state: MockState = { inserts: [], updates: [], selectResults: [] };
    const svc = await buildService(state);
    await expect(svc.rotateRefreshToken('garbage')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects refresh token with valid format but unknown id', async () => {
    const state: MockState = {
      inserts: [],
      updates: [],
      selectResults: [[]],
    };
    const svc = await buildService(state);
    const fakeToken = '0190a000-0000-7000-8000-000000000001.' + 'x'.repeat(20);
    await expect(svc.rotateRefreshToken(fakeToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects revoked refresh token and revokes the family', async () => {
    const tokenId = '0190a000-0000-7000-8000-00000000abcd';
    const familyId = '0190a000-0000-7000-8000-00000000beef';
    const secret = 'thesharedsecretpart';
    const tokenHash = createHash('sha256').update(secret).digest('hex');

    const state: MockState = {
      inserts: [],
      updates: [],
      selectResults: [
        [
          {
            id: tokenId,
            userId: '0190a000-0000-7000-8000-000000000001',
            familyId,
            tokenHash,
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: new Date(),
            replacedById: null,
            userAgent: null,
            ipAddress: null,
            createdAt: new Date(),
          },
        ],
      ],
    };
    const svc = await buildService(state);

    await expect(
      svc.rotateRefreshToken(`${tokenId}.${secret}`),
    ).rejects.toThrow(/reused/i);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].revokedAt).toBeInstanceOf(Date);
  });

  it('rejects expired refresh token', async () => {
    const tokenId = '0190a000-0000-7000-8000-00000000aaaa';
    const secret = 'sharedSecret';
    const tokenHash = createHash('sha256').update(secret).digest('hex');

    const state: MockState = {
      inserts: [],
      updates: [],
      selectResults: [
        [
          {
            id: tokenId,
            userId: 'u',
            familyId: 'f',
            tokenHash,
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() - 1000),
            revokedAt: null,
            replacedById: null,
            userAgent: null,
            ipAddress: null,
            createdAt: new Date(),
          },
        ],
      ],
    };
    const svc = await buildService(state);
    await expect(
      svc.rotateRefreshToken(`${tokenId}.${secret}`),
    ).rejects.toThrow(/expired/i);
  });

  it('rotates a valid refresh token, issues new pair, revokes old', async () => {
    const tokenId = '0190a000-0000-7000-8000-000000001111';
    const secret = 'validsecret';
    const tokenHash = createHash('sha256').update(secret).digest('hex');
    const user = makeUser();

    const state: MockState = {
      inserts: [],
      updates: [],
      selectResults: [
        [
          {
            id: tokenId,
            userId: user.id,
            familyId: 'family-1',
            tokenHash,
            issuedAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
            revokedAt: null,
            replacedById: null,
            userAgent: null,
            ipAddress: null,
            createdAt: new Date(),
          },
        ],
        [user],
      ],
    };
    const svc = await buildService(state);

    const result = await svc.rotateRefreshToken(`${tokenId}.${secret}`);

    expect(result.user.id).toBe(user.id);
    expect(result.tokens.refreshToken).not.toBe(`${tokenId}.${secret}`);
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0].familyId).toBe('family-1');
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].revokedAt).toBeInstanceOf(Date);
    expect(state.updates[0].replacedById).toBeDefined();
  });
});
