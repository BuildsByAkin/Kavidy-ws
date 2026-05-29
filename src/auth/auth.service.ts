import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { EligibilityService } from '../common/geo/eligibility.service';
import {
  DRIZZLE,
  type Database,
  type DbExecutor,
} from '../database/database.module';
import { balances } from '../database/schema/balances';
import type { UserRow } from '../database/schema/users';
import {
  UsersService,
  normalizeEmail,
  normalizeUsername,
} from '../users/users.service';
import { toPublicUser, type PublicUser } from '../users/users.mapper';
import { GoogleService } from './google.service';
import { PasswordResetService } from './password-reset.service';
import {
  TokensService,
  type IssuedTokenPair,
  type RequestContext,
} from './tokens.service';

export interface AuthResult {
  user: PublicUser;
  tokens: IssuedTokenPair;
}

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly google: GoogleService,
    private readonly eligibility: EligibilityService,
    private readonly passwordReset: PasswordResetService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async signup(
    input: {
      email: string;
      username: string;
      password: string;
      dateOfBirth: string;
      state: string;
      country?: string;
    },
    ctx: RequestContext = {},
  ): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);

    const eligibility = this.eligibility.assertEligible({
      dateOfBirth: input.dateOfBirth,
      state: input.state,
      country: input.country,
    });

    const [existingEmail, existingUsername] = await Promise.all([
      this.users.findByEmail(email),
      this.users.findByUsername(username),
    ]);
    if (existingEmail) {
      throw new ConflictException('Email is already in use');
    }
    if (existingUsername) {
      throw new ConflictException('Username is already taken');
    }

    const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);

    let user: UserRow;
    try {
      user = await this.db.transaction(async (tx) => {
        const created = await this.users.createWithPassword(
          {
            email,
            username,
            passwordHash,
            dateOfBirth: eligibility.dateOfBirth,
            state: eligibility.state,
            country: eligibility.country,
          },
          tx,
        );
        await this.provisionBalanceRow(created.id, tx);
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Email or username is already in use');
      }
      throw err;
    }

    const tokens = await this.tokens.issueTokenPair(user, ctx);
    await this.users.touchLastLogin(user.id);
    this.logger.log(`User signed up: ${user.id}`);

    return { user: toPublicUser(user), tokens };
  }

  async login(
    input: { email: string; password: string },
    ctx: RequestContext = {},
  ): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);

    if (!user || !user.passwordHash) {
      await argon2VerifyDummy();
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Account is not active');
    }

    const tokens = await this.tokens.issueTokenPair(user, ctx);
    await this.users.touchLastLogin(user.id);
    this.logger.log(`User logged in: ${user.id}`);

    return { user: toPublicUser(user), tokens };
  }

  async loginWithGoogle(
    input: { idToken: string; username?: string },
    ctx: RequestContext = {},
  ): Promise<AuthResult> {
    const identity = await this.google.verifyIdToken(input.idToken);

    const linked = await this.users.findOAuthAccount('google', identity.sub);
    if (linked) {
      const user = await this.users.findById(linked.userId);
      if (!user) {
        throw new UnauthorizedException('Linked account no longer exists');
      }
      if (user.status !== 'active') {
        throw new UnauthorizedException('Account is not active');
      }
      const tokens = await this.tokens.issueTokenPair(user, ctx);
      await this.users.touchLastLogin(user.id);
      this.logger.log(`User logged in via Google: ${user.id}`);
      return { user: toPublicUser(user), tokens };
    }

    const existingByEmail = await this.users.findByEmail(identity.email);
    if (existingByEmail) {
      throw new ConflictException(
        'An account with this email already exists. Sign in with your password to link Google.',
      );
    }

    const username = await this.resolveUsernameForGoogle(
      input.username,
      identity.email,
    );

    let user: UserRow;
    try {
      user = await this.db.transaction(async (tx) => {
        const created = await this.users.createWithOAuth(
          {
            email: identity.email,
            username,
            emailVerified: identity.emailVerified,
            displayName: identity.name,
            avatarUrl: identity.picture,
          },
          tx,
        );
        await this.users.linkOAuthAccount(
          {
            userId: created.id,
            provider: 'google',
            providerAccountId: identity.sub,
            email: identity.email,
            emailVerified: identity.emailVerified,
            displayName: identity.name,
            avatarUrl: identity.picture,
            raw: identity.raw as unknown as Record<string, unknown>,
          },
          tx,
        );
        await this.provisionBalanceRow(created.id, tx);
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException('Email or username is already in use');
      }
      throw err;
    }

    const tokens = await this.tokens.issueTokenPair(user, ctx);
    await this.users.touchLastLogin(user.id);
    this.logger.log(`User signed up via Google: ${user.id}`);

    return { user: toPublicUser(user), tokens };
  }

  async refresh(
    refreshToken: string,
    ctx: RequestContext = {},
  ): Promise<AuthResult> {
    const { user, tokens } = await this.tokens.rotateRefreshToken(
      refreshToken,
      ctx,
    );
    return { user: toPublicUser(user), tokens };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeRefreshToken(refreshToken);
  }

  async requestPasswordReset(
    email: string,
    ctx: RequestContext = {},
  ): Promise<void> {
    const normalized = normalizeEmail(email);
    const user = await this.users.findByEmail(normalized);
    if (!user || !user.passwordHash || user.status !== 'active') {
      this.logger.log(`Password reset requested for unknown/ineligible email`);
      return;
    }
    await this.passwordReset.createAndSend(user, ctx);
  }

  async confirmPasswordReset(
    token: string,
    newPassword: string,
  ): Promise<void> {
    const passwordHash = await argon2.hash(newPassword, ARGON2_OPTIONS);
    const userId = await this.db.transaction(async (tx) => {
      const tokenRow = await this.passwordReset.consume(token, tx);
      await this.users.updateProfile(tokenRow.userId, { passwordHash }, tx);
      await this.tokens.revokeAllForUser(tokenRow.userId, undefined, tx);
      return tokenRow.userId;
    });
    this.logger.log(`Password reset completed for user ${userId}`);
  }

  async completeProfile(
    userId: string,
    input: { dateOfBirth: string; state: string; country?: string },
  ): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const eligibility = this.eligibility.assertEligible({
      dateOfBirth: input.dateOfBirth,
      state: input.state,
      country: input.country,
    });
    const updated = await this.users.updateProfile(userId, {
      dateOfBirth: eligibility.dateOfBirth,
      state: eligibility.state,
      country: eligibility.country,
    });
    return toPublicUser(updated);
  }

  private async provisionBalanceRow(
    userId: string,
    tx: DbExecutor,
  ): Promise<void> {
    await tx
      .insert(balances)
      .values({ userId })
      .onConflictDoNothing({ target: balances.userId });
  }

  private async resolveUsernameForGoogle(
    requested: string | undefined,
    email: string,
  ): Promise<string> {
    if (requested) {
      const existing = await this.users.findByUsername(requested);
      if (existing) {
        throw new ConflictException('Username is already taken');
      }
      return normalizeUsername(requested);
    }

    const base =
      email
        .split('@')[0]
        .replace(/[^a-zA-Z0-9_]/g, '')
        .slice(0, 16) || 'user';
    for (let attempt = 0; attempt < 8; attempt++) {
      const suffix =
        attempt === 0 ? '' : Math.floor(1000 + Math.random() * 9000).toString();
      const candidate = `${base}${suffix}`.slice(0, 20);
      if (candidate.length < 3) continue;
      const existing = await this.users.findByUsername(candidate);
      if (!existing) return candidate;
    }
    throw new ConflictException('Could not generate a unique username');
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

async function argon2VerifyDummy(): Promise<void> {
  // constant-time guard to mitigate user enumeration on login
  try {
    await argon2.verify(
      '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlkdW1teWR1bW15$1u4SLB0WV/2lzgKJh2bbDtoZRyKqxXEt9oQjV3w8sBg',
      'dummy',
    );
  } catch {
    // ignore
  }
}
