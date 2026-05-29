import {
  UsersService,
  normalizeEmail,
  normalizeUsername,
} from './users.service';

describe('normalizers', () => {
  it('lowercases and trims email', () => {
    expect(normalizeEmail('  Jane@Example.COM ')).toBe('jane@example.com');
  });
  it('trims username only', () => {
    expect(normalizeUsername('  Jane  ')).toBe('Jane');
  });
});

describe('UsersService DB call shape', () => {
  function makeDb() {
    const state = {
      inserts: [] as any[],
      updates: [] as any[],
      selectResults: [] as any[][],
    };
    const db = {
      insert: () => ({
        values: (v: any) => ({
          returning: async () => {
            state.inserts.push(v);
            return [{ ...v, createdAt: new Date(), updatedAt: new Date() }];
          },
        }),
      }),
      update: () => ({
        set: (patch: any) => ({
          where: async () => {
            state.updates.push(patch);
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => state.selectResults.shift() ?? [],
          }),
        }),
      }),
    };
    return { db, state };
  }

  it('createWithPassword normalizes inputs and inserts a uuid', async () => {
    const { db, state } = makeDb();
    const svc = new UsersService(db as any);
    const row = await svc.createWithPassword({
      email: 'NEW@EX.COM',
      username: '  newuser  ',
      passwordHash: 'h',
      dateOfBirth: '1990-01-01',
      state: 'CA',
    });
    expect(row.email).toBe('new@ex.com');
    expect(row.username).toBe('newuser');
    expect(state.inserts[0].id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('createWithOAuth sets emailVerifiedAt when verified', async () => {
    const { db, state } = makeDb();
    const svc = new UsersService(db as any);
    await svc.createWithOAuth({
      email: 'g@x.com',
      username: 'g',
      emailVerified: true,
    });
    expect(state.inserts[0].emailVerified).toBe(true);
    expect(state.inserts[0].emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('touchLastLogin issues an update with timestamps', async () => {
    const { db, state } = makeDb();
    const svc = new UsersService(db as any);
    await svc.touchLastLogin('id');
    expect(state.updates[0].lastLoginAt).toBeInstanceOf(Date);
    expect(state.updates[0].updatedAt).toBeInstanceOf(Date);
  });
});
