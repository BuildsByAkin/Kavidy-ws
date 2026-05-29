import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccountService } from './account.service';

interface MockUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  notificationPrefs: { emailDigest: boolean; marketAlerts: boolean };
  emailVerified?: boolean;
  emailVerifiedAt?: Date | null;
  role?: 'user' | 'admin' | 'curator';
  onboardingStatus?: 'incomplete' | 'active';
  avatarUrl?: string | null;
  dateOfBirth?: string | null;
  country?: string;
  state?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

function makeDeps(initial: MockUser) {
  const store: { user: MockUser } = {
    user: {
      emailVerified: true,
      emailVerifiedAt: null,
      role: 'user',
      onboardingStatus: 'active',
      avatarUrl: null,
      dateOfBirth: null,
      country: 'US',
      state: null,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
      ...initial,
    },
  };

  const tx = {} as never;
  const db = {
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  } as never;

  const users = {
    findById: jest.fn(async (id: string) =>
      id === store.user.id ? store.user : null,
    ),
    findByDisplayName: jest.fn(async (name: string) => {
      if (store.user.displayName?.toLowerCase() === name.trim().toLowerCase()) {
        return store.user;
      }
      return null;
    }),
    findByEmail: jest.fn(async (email: string) => {
      if (store.user.email.toLowerCase() === email.toLowerCase()) {
        return store.user;
      }
      return null;
    }),
    updateDisplayName: jest.fn(async (_id: string, name: string) => {
      store.user.displayName = name;
      return store.user;
    }),
    updateEmail: jest.fn(async (_id: string, email: string) => {
      store.user.email = email.toLowerCase();
      return store.user;
    }),
    updateNotificationPrefs: jest.fn(async (_id: string, prefs) => {
      store.user.notificationPrefs = prefs;
      return store.user;
    }),
    softDeleteAccount: jest.fn(async (_id: string) => {
      store.user.status = 'deleted';
      return store.user;
    }),
  };

  const tokens = {
    revokeAllForUser: jest.fn(async () => 1),
  };

  const ledger = {
    getBalance: jest.fn(async () => ({
      sweepsCashableCents: 0,
      sweepsLockedCents: 0,
      sweepsTotalCents: 0,
    })),
  };

  const svc = new AccountService(
    db,
    users as never,
    tokens as never,
    ledger as never,
  );
  return { svc, users, tokens, ledger, store };
}

const baseUser: MockUser = {
  id: 'u1',
  email: 'jane@example.com',
  username: 'jane',
  displayName: 'Jane',
  status: 'active',
  notificationPrefs: { emailDigest: true, marketAlerts: true },
};

describe('AccountService.updateDisplayName', () => {
  it('updates the display name when unique', async () => {
    const { svc, users } = makeDeps(baseUser);
    const result = await svc.updateDisplayName('u1', '  Jane Q  ');
    expect(result.displayName).toBe('Jane Q');
    expect(users.updateDisplayName).toHaveBeenCalledWith('u1', 'Jane Q');
  });

  it('is a no-op when name unchanged (case-insensitive)', async () => {
    const { svc, users } = makeDeps(baseUser);
    const result = await svc.updateDisplayName('u1', 'jane');
    expect(result.displayName).toBe('Jane');
    expect(users.updateDisplayName).not.toHaveBeenCalled();
  });

  it('throws ConflictException when display name is taken by another user', async () => {
    const { svc, users } = makeDeps(baseUser);
    users.findByDisplayName.mockResolvedValueOnce({
      ...baseUser,
      id: 'other',
      displayName: 'Taken',
    });
    await expect(svc.updateDisplayName('u1', 'Taken')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws NotFound when user missing', async () => {
    const { svc, users } = makeDeps(baseUser);
    users.findById.mockResolvedValueOnce(null);
    await expect(svc.updateDisplayName('u1', 'Foo')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('AccountService.updateEmail', () => {
  it('updates email, invalidates verification, and revokes sessions', async () => {
    const { svc, users, tokens } = makeDeps(baseUser);
    const result = await svc.updateEmail('u1', 'NEW@Example.com');
    expect(result.email).toBe('new@example.com');
    expect(users.updateEmail).toHaveBeenCalledWith(
      'u1',
      'new@example.com',
      expect.anything(),
    );
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      undefined,
      expect.anything(),
    );
  });

  it('is a no-op when email unchanged', async () => {
    const { svc, users, tokens } = makeDeps(baseUser);
    await svc.updateEmail('u1', 'jane@example.com');
    expect(users.updateEmail).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('throws ConflictException when email is taken', async () => {
    const { svc, users } = makeDeps(baseUser);
    users.findByEmail.mockResolvedValueOnce({
      ...baseUser,
      id: 'other',
      email: 'taken@example.com',
    });
    await expect(
      svc.updateEmail('u1', 'taken@example.com'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AccountService.updateNotificationPrefs', () => {
  it('merges partial updates with existing prefs', async () => {
    const { svc, users } = makeDeps(baseUser);
    const result = await svc.updateNotificationPrefs('u1', {
      emailDigest: false,
    });
    expect(result.notificationPrefs).toEqual({
      emailDigest: false,
      marketAlerts: true,
    });
    expect(users.updateNotificationPrefs).toHaveBeenCalledWith('u1', {
      emailDigest: false,
      marketAlerts: true,
    });
  });

  it('updates both flags when both provided', async () => {
    const { svc } = makeDeps(baseUser);
    const result = await svc.updateNotificationPrefs('u1', {
      emailDigest: false,
      marketAlerts: false,
    });
    expect(result.notificationPrefs).toEqual({
      emailDigest: false,
      marketAlerts: false,
    });
  });
});

describe('AccountService.deleteAccount', () => {
  it('soft-deletes when handle matches and revokes all sessions', async () => {
    const { svc, users, tokens, store } = makeDeps(baseUser);
    await svc.deleteAccount('u1', 'jane');
    expect(users.softDeleteAccount).toHaveBeenCalledWith(
      'u1',
      expect.anything(),
    );
    expect(tokens.revokeAllForUser).toHaveBeenCalledWith(
      'u1',
      undefined,
      expect.anything(),
    );
    expect(store.user.status).toBe('deleted');
  });

  it('accepts case-insensitive and whitespace-padded handle', async () => {
    const { svc, users } = makeDeps(baseUser);
    await svc.deleteAccount('u1', '  JANE  ');
    expect(users.softDeleteAccount).toHaveBeenCalled();
  });

  it('rejects when handle does not match', async () => {
    const { svc, users, tokens } = makeDeps(baseUser);
    await expect(svc.deleteAccount('u1', 'not-jane')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(users.softDeleteAccount).not.toHaveBeenCalled();
    expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
  });

  it('rejects when handle is empty', async () => {
    const { svc, users } = makeDeps(baseUser);
    await expect(svc.deleteAccount('u1', '   ')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(users.softDeleteAccount).not.toHaveBeenCalled();
  });

  it('blocks deletion when cashable Sweeps balance remains', async () => {
    const { svc, ledger, users } = makeDeps(baseUser);
    ledger.getBalance.mockResolvedValueOnce({
      sweepsCashableCents: 100,
      sweepsLockedCents: 0,
      sweepsTotalCents: 100,
    });
    await expect(svc.deleteAccount('u1', 'jane')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(users.softDeleteAccount).not.toHaveBeenCalled();
  });

  it('rejects when account already deleted', async () => {
    const { svc } = makeDeps({ ...baseUser, status: 'deleted' });
    await expect(svc.deleteAccount('u1', 'jane')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects when user missing', async () => {
    const { svc, users } = makeDeps(baseUser);
    users.findById.mockResolvedValueOnce(null);
    await expect(svc.deleteAccount('u1', 'jane')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
