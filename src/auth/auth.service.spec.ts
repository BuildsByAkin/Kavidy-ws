import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { EligibilityService } from '../common/geo/eligibility.service';
import { AuthService } from './auth.service';
import { GoogleService } from './google.service';
import { PasswordResetService } from './password-reset.service';
import { TokensService } from './tokens.service';
import type { UserRow } from '../database/schema/users';

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: '0190a000-0000-7000-8000-000000000001',
    email: 'jane@example.com',
    username: 'jane',
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

const SIGNUP_DEFAULTS = {
  dateOfBirth: '1990-01-01',
  state: 'CA',
};

describe('AuthService', () => {
  let users: any;
  let tokens: any;
  let google: any;
  let passwordReset: any;
  let db: any;
  let svc: AuthService;

  const tokenPair = {
    accessToken: 'access',
    refreshToken: 'rid.secret',
    accessTokenExpiresAt: new Date().toISOString(),
    refreshTokenExpiresAt: new Date().toISOString(),
  };

  beforeEach(() => {
    users = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findByUsername: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      findOAuthAccount: jest.fn().mockResolvedValue(null),
      createWithPassword: jest.fn(),
      createWithOAuth: jest.fn(),
      linkOAuthAccount: jest.fn().mockResolvedValue(undefined),
      touchLastLogin: jest.fn().mockResolvedValue(undefined),
    };
    tokens = {
      issueTokenPair: jest.fn().mockResolvedValue(tokenPair),
      rotateRefreshToken: jest.fn(),
      revokeRefreshToken: jest.fn().mockResolvedValue(undefined),
    };
    google = {
      verifyIdToken: jest.fn(),
    };
    passwordReset = {
      createAndSend: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn(),
    };
    const txMock = {
      insert: jest.fn(() => ({
        values: jest.fn(() => ({ onConflictDoNothing: jest.fn() })),
      })),
    };
    db = {
      transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) =>
        cb(txMock as any),
      ),
      _tx: txMock,
    };
    svc = new AuthService(
      users,
      tokens as TokensService,
      google as GoogleService,
      new EligibilityService(),
      passwordReset as PasswordResetService,
      db,
    );
  });

  describe('signup', () => {
    it('creates a user with hashed password and returns tokens', async () => {
      const created = makeUser({
        email: 'jane@example.com',
        username: 'jane',
        passwordHash: 'hash',
      });
      users.createWithPassword.mockResolvedValue(created);

      const result = await svc.signup({
        email: 'JANE@example.com',
        username: 'jane',
        password: 'longenough123',
        ...SIGNUP_DEFAULTS,
      });

      expect(users.createWithPassword).toHaveBeenCalledTimes(1);
      const arg = users.createWithPassword.mock.calls[0][0];
      expect(arg.email).toBe('jane@example.com');
      expect(arg.username).toBe('jane');
      expect(arg.passwordHash).not.toBe('longenough123');
      await expect(
        argon2.verify(arg.passwordHash, 'longenough123'),
      ).resolves.toBe(true);

      expect(result.user.email).toBe('jane@example.com');
      expect(result.tokens).toEqual(tokenPair);
      expect(users.touchLastLogin).toHaveBeenCalledWith(created.id);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(db._tx.insert).toHaveBeenCalled();
    });

    it('rejects duplicate email', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      await expect(
        svc.signup({
          email: 'jane@example.com',
          username: 'newname',
          password: 'longenough123',
          ...SIGNUP_DEFAULTS,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(users.createWithPassword).not.toHaveBeenCalled();
    });

    it('rejects duplicate username', async () => {
      users.findByUsername.mockResolvedValue(makeUser());
      await expect(
        svc.signup({
          email: 'new@example.com',
          username: 'jane',
          password: 'longenough123',
          ...SIGNUP_DEFAULTS,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects underage signup before touching DB', async () => {
      const now = new Date();
      const dob = `${now.getUTCFullYear() - 12}-06-01`;
      await expect(
        svc.signup({
          email: 'kid@example.com',
          username: 'kid',
          password: 'longenough123',
          dateOfBirth: dob,
          state: 'CA',
        }),
      ).rejects.toBeDefined();
      expect(users.createWithPassword).not.toHaveBeenCalled();
    });

    it('rejects signup from restricted state', async () => {
      await expect(
        svc.signup({
          email: 'wa@example.com',
          username: 'waguy',
          password: 'longenough123',
          dateOfBirth: '1990-01-01',
          state: 'WA',
        }),
      ).rejects.toBeDefined();
      expect(users.createWithPassword).not.toHaveBeenCalled();
    });

    it('maps unique-violation race to conflict', async () => {
      users.createWithPassword.mockRejectedValue(
        Object.assign(new Error('dup'), { code: '23505' }),
      );
      await expect(
        svc.signup({
          email: 'a@b.com',
          username: 'abc',
          password: 'longenough123',
          ...SIGNUP_DEFAULTS,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('rejects unknown email with generic error', async () => {
      await expect(
        svc.login({ email: 'no@one.com', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects oauth-only user (no password) with generic error', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ passwordHash: null }));
      await expect(
        svc.login({ email: 'jane@example.com', password: 'whatever' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects bad password', async () => {
      const hash = await argon2.hash('correct-password', {
        type: argon2.argon2id,
      });
      users.findByEmail.mockResolvedValue(makeUser({ passwordHash: hash }));
      await expect(
        svc.login({ email: 'jane@example.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects suspended accounts', async () => {
      const hash = await argon2.hash('correct-password', {
        type: argon2.argon2id,
      });
      users.findByEmail.mockResolvedValue(
        makeUser({ passwordHash: hash, status: 'suspended' }),
      );
      await expect(
        svc.login({ email: 'jane@example.com', password: 'correct-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('logs in with correct credentials', async () => {
      const hash = await argon2.hash('correct-password', {
        type: argon2.argon2id,
      });
      const user = makeUser({ passwordHash: hash });
      users.findByEmail.mockResolvedValue(user);

      const result = await svc.login({
        email: 'jane@example.com',
        password: 'correct-password',
      });
      expect(result.tokens).toEqual(tokenPair);
      expect(users.touchLastLogin).toHaveBeenCalledWith(user.id);
    });
  });

  describe('loginWithGoogle', () => {
    const identity = {
      sub: 'google-sub-123',
      email: 'google@example.com',
      emailVerified: true,
      name: 'Google User',
      givenName: 'Google',
      familyName: 'User',
      picture: 'https://pic',
      raw: {} as any,
    };

    it('signs in existing linked user', async () => {
      google.verifyIdToken.mockResolvedValue(identity);
      const user = makeUser({ email: 'google@example.com' });
      users.findOAuthAccount.mockResolvedValue({ userId: user.id });
      users.findById.mockResolvedValue(user);

      const result = await svc.loginWithGoogle({ idToken: 'tok' });
      expect(result.user.id).toBe(user.id);
      expect(users.createWithOAuth).not.toHaveBeenCalled();
    });

    it('refuses if email already registered with password', async () => {
      google.verifyIdToken.mockResolvedValue(identity);
      users.findByEmail.mockResolvedValue(
        makeUser({ email: 'google@example.com', passwordHash: 'h' }),
      );
      await expect(
        svc.loginWithGoogle({ idToken: 'tok' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates new user when no link and no email collision', async () => {
      google.verifyIdToken.mockResolvedValue(identity);
      const created = makeUser({
        email: 'google@example.com',
        username: 'google',
        emailVerified: true,
      });
      users.createWithOAuth.mockResolvedValue(created);

      const result = await svc.loginWithGoogle({ idToken: 'tok' });
      expect(users.createWithOAuth).toHaveBeenCalled();
      expect(users.linkOAuthAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          providerAccountId: 'google-sub-123',
          userId: created.id,
        }),
        expect.anything(),
      );
      expect(result.user.email).toBe('google@example.com');
    });

    it('uses requested username when provided and free', async () => {
      google.verifyIdToken.mockResolvedValue(identity);
      const created = makeUser({ username: 'chosen_name' });
      users.createWithOAuth.mockResolvedValue(created);

      await svc.loginWithGoogle({ idToken: 'tok', username: 'chosen_name' });
      expect(users.createWithOAuth.mock.calls[0][0].username).toBe(
        'chosen_name',
      );
    });

    it('rejects requested username already taken', async () => {
      google.verifyIdToken.mockResolvedValue(identity);
      users.findByUsername.mockImplementation((u: string) =>
        Promise.resolve(u === 'taken' ? makeUser() : null),
      );
      await expect(
        svc.loginWithGoogle({ idToken: 'tok', username: 'taken' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('password reset', () => {
    it('silently returns when user does not exist', async () => {
      users.findByEmail.mockResolvedValue(null);
      await expect(
        svc.requestPasswordReset('nobody@nowhere.com'),
      ).resolves.toBeUndefined();
      expect(passwordReset.createAndSend).not.toHaveBeenCalled();
    });

    it('silently returns for oauth-only user (no password)', async () => {
      users.findByEmail.mockResolvedValue(makeUser({ passwordHash: null }));
      await svc.requestPasswordReset('jane@example.com');
      expect(passwordReset.createAndSend).not.toHaveBeenCalled();
    });

    it('issues token when account is eligible', async () => {
      const user = makeUser({ passwordHash: 'h' });
      users.findByEmail.mockResolvedValue(user);
      await svc.requestPasswordReset('jane@example.com');
      expect(passwordReset.createAndSend).toHaveBeenCalledWith(user, {});
    });

    it('confirm rotates password and revokes all sessions', async () => {
      passwordReset.consume.mockResolvedValue({
        userId: 'user-id-1',
      });
      users.updateProfile = jest.fn().mockResolvedValue(makeUser());
      tokens.revokeAllForUser = jest.fn().mockResolvedValue(2);

      await svc.confirmPasswordReset('tok.secret', 'a-new-password');

      expect(users.updateProfile).toHaveBeenCalledWith(
        'user-id-1',
        expect.objectContaining({ passwordHash: expect.any(String) }),
        expect.anything(),
      );
      const newHash = users.updateProfile.mock.calls[0][1].passwordHash;
      expect(newHash).not.toBe('a-new-password');
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith(
        'user-id-1',
        undefined,
        expect.anything(),
      );
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(passwordReset.consume).toHaveBeenCalledWith(
        'tok.secret',
        expect.anything(),
      );
    });
  });

  describe('completeProfile', () => {
    it('rejects when underage', async () => {
      users.findById.mockResolvedValue(makeUser());
      const now = new Date();
      await expect(
        svc.completeProfile('u', {
          dateOfBirth: `${now.getUTCFullYear() - 10}-01-01`,
          state: 'CA',
        }),
      ).rejects.toBeDefined();
    });

    it('updates profile with normalized state', async () => {
      users.findById.mockResolvedValue(makeUser());
      users.updateProfile = jest
        .fn()
        .mockResolvedValue(
          makeUser({ state: 'NY', dateOfBirth: '1985-05-05' }),
        );

      const out = await svc.completeProfile('u', {
        dateOfBirth: '1985-05-05',
        state: 'ny',
      });
      expect(users.updateProfile).toHaveBeenCalledWith('u', {
        dateOfBirth: '1985-05-05',
        state: 'NY',
        country: 'US',
      });
      expect(out.state).toBe('NY');
    });
  });

  describe('refresh / logout', () => {
    it('delegates refresh to tokens service', async () => {
      tokens.rotateRefreshToken.mockResolvedValue({
        user: makeUser(),
        tokens: tokenPair,
      });
      const out = await svc.refresh('any.token');
      expect(tokens.rotateRefreshToken).toHaveBeenCalled();
      expect(out.tokens).toEqual(tokenPair);
    });

    it('delegates logout to tokens service', async () => {
      await svc.logout('any.token');
      expect(tokens.revokeRefreshToken).toHaveBeenCalledWith('any.token');
    });
  });
});
