import { BadRequestException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import type { UserRow } from '../database/schema/users';

function makeUser(): UserRow {
  return {
    id: '0190a000-0000-7000-8000-000000000001',
    email: 'jane@example.com',
    username: 'jane',
    passwordHash: 'h',
    emailVerified: true,
    emailVerifiedAt: new Date(),
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
  };
}

interface DbState {
  rows: any[];
  inserts: any[];
  updates: any[];
}

function makeDb(state: DbState): any {
  return {
    insert: () => ({
      values: (v: any) => {
        state.inserts.push(v);
        state.rows.push({
          ...v,
          usedAt: null,
          createdAt: new Date(),
        });
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (patch: any) => ({
        where: () => {
          state.rows = state.rows.map((r) => ({ ...r, ...patch }));
          state.updates.push(patch);
          return {
            returning: () => Promise.resolve(state.rows),
          };
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(state.rows.slice(-1)),
        }),
      }),
    }),
  };
}

describe('PasswordResetService', () => {
  let state: DbState;
  let email: any;
  let config: any;
  let svc: PasswordResetService;

  beforeEach(() => {
    state = { rows: [], inserts: [], updates: [] };
    email = { sendPasswordReset: jest.fn().mockResolvedValue(undefined) };
    config = { get: () => 'https://app.test/reset' };
    svc = new PasswordResetService(makeDb(state), email, config);
  });

  it('creates token and sends email with url containing token', async () => {
    await svc.createAndSend(makeUser());
    expect(state.inserts).toHaveLength(1);
    expect(email.sendPasswordReset).toHaveBeenCalledTimes(1);
    const call = email.sendPasswordReset.mock.calls[0][0];
    expect(call.to).toBe('jane@example.com');
    expect(call.resetUrl).toContain('https://app.test/reset?token=');
    expect(call.token).toMatch(/^[0-9a-f-]{36}\..+/i);
  });

  it('rejects malformed reset token', async () => {
    await expect(svc.consume('not-a-token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('consumes a valid token and marks it used', async () => {
    await svc.createAndSend(makeUser());
    const token = email.sendPasswordReset.mock.calls[0][0].token;
    const row = await svc.consume(token);
    expect(row.usedAt).toBeTruthy();
  });

  it('rejects an already-used token', async () => {
    await svc.createAndSend(makeUser());
    const token = email.sendPasswordReset.mock.calls[0][0].token;
    await svc.consume(token);
    await expect(svc.consume(token)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects an expired token', async () => {
    await svc.createAndSend(makeUser());
    const token = email.sendPasswordReset.mock.calls[0][0].token;
    state.rows[state.rows.length - 1].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.consume(token)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
