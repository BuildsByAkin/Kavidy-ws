import { randomUUID } from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  DRIZZLE,
  type Database,
  type DbExecutor,
} from '../database/database.module';
import {
  oauthAccounts,
  type NewOAuthAccountRow,
  type OAuthAccountRow,
} from '../database/schema/oauth-accounts';
import { users, type UserRow } from '../database/schema/users';

export interface CreateUserWithPasswordInput {
  email: string;
  username: string;
  passwordHash: string;
  dateOfBirth: string;
  state: string;
  country?: string;
}

export interface CreateUserWithOAuthInput {
  email: string;
  username: string;
  emailVerified: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
  dateOfBirth?: string | null;
  state?: string | null;
  country?: string;
}

export interface UpdateProfileInput {
  dateOfBirth?: string;
  state?: string;
  country?: string;
  passwordHash?: string;
}

export interface LinkOAuthInput {
  userId: string;
  provider: 'google';
  providerAccountId: string;
  email?: string | null;
  emailVerified: boolean;
  displayName?: string | null;
  avatarUrl?: string | null;
  raw?: Record<string, unknown>;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeUsername(username: string): string {
  return username.trim();
}

@Injectable()
export class UsersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const normalized = normalizeEmail(email);
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`)
      .limit(1);
    return row ?? null;
  }

  async findByUsername(username: string): Promise<UserRow | null> {
    const normalized = normalizeUsername(username).toLowerCase();
    const [row] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${normalized}`)
      .limit(1);
    return row ?? null;
  }

  async createWithPassword(
    input: CreateUserWithPasswordInput,
    tx?: DbExecutor,
  ): Promise<UserRow> {
    const exec = tx ?? this.db;
    const [row] = await exec
      .insert(users)
      .values({
        id: randomUUID(),
        email: normalizeEmail(input.email),
        username: normalizeUsername(input.username),
        passwordHash: input.passwordHash,
        dateOfBirth: input.dateOfBirth,
        state: input.state,
        country: input.country ?? 'US',
      })
      .returning();
    return row;
  }

  async createWithOAuth(
    input: CreateUserWithOAuthInput,
    tx?: DbExecutor,
  ): Promise<UserRow> {
    const exec = tx ?? this.db;
    const [row] = await exec
      .insert(users)
      .values({
        id: randomUUID(),
        email: normalizeEmail(input.email),
        username: normalizeUsername(input.username),
        emailVerified: input.emailVerified,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        dateOfBirth: input.dateOfBirth ?? null,
        state: input.state ?? null,
        country: input.country ?? 'US',
      })
      .returning();
    return row;
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
    tx?: DbExecutor,
  ): Promise<UserRow> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.dateOfBirth !== undefined) patch.dateOfBirth = input.dateOfBirth;
    if (input.state !== undefined) patch.state = input.state;
    if (input.country !== undefined) patch.country = input.country;
    if (input.passwordHash !== undefined)
      patch.passwordHash = input.passwordHash;

    const exec = tx ?? this.db;
    const [row] = await exec
      .update(users)
      .set(patch)
      .where(eq(users.id, userId))
      .returning();
    return row;
  }

  async linkOAuthAccount(
    input: LinkOAuthInput,
    tx?: DbExecutor,
  ): Promise<OAuthAccountRow> {
    const values: NewOAuthAccountRow = {
      id: randomUUID(),
      userId: input.userId,
      provider: input.provider,
      providerAccountId: input.providerAccountId,
      email: input.email ?? null,
      emailVerified: input.emailVerified,
      displayName: input.displayName ?? null,
      avatarUrl: input.avatarUrl ?? null,
      raw: input.raw ?? null,
    };
    const exec = tx ?? this.db;
    const [row] = await exec.insert(oauthAccounts).values(values).returning();
    return row;
  }

  async findOAuthAccount(
    provider: 'google',
    providerAccountId: string,
  ): Promise<OAuthAccountRow | null> {
    const [row] = await this.db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.provider, provider),
          eq(oauthAccounts.providerAccountId, providerAccountId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async touchLastLogin(userId: string): Promise<void> {
    const now = new Date();
    await this.db
      .update(users)
      .set({ lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, userId));
  }
}
