import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Env } from '../config/env';
import {
  DRIZZLE,
  type Database,
  type DbExecutor,
} from '../database/database.module';
import {
  refreshTokens,
  type RefreshTokenRow,
} from '../database/schema/refresh-tokens';
import { users, type UserRow } from '../database/schema/users';

export interface JwtAccessPayload {
  sub: string;
  email: string;
  role: UserRow['role'];
  sid: string;
}

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
}

export interface RequestContext {
  userAgent?: string | null;
  ipAddress?: string | null;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export interface IssueOptions {
  revokeOthers?: boolean;
  rememberMe?: boolean;
  absoluteExpiresAt?: Date;
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly accessSecret: string;
  private readonly accessTtl: string;
  private readonly refreshTtlMs: number;
  private readonly refreshShortTtlMs: number;
  private readonly refreshAbsoluteTtlMs: number;
  private readonly refreshIdleTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {
    this.accessSecret = this.config.get('JWT_ACCESS_SECRET', { infer: true });
    this.accessTtl = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const days = this.config.get('JWT_REFRESH_TTL_DAYS', { infer: true });
    this.refreshTtlMs = days * 24 * 60 * 60 * 1000;
    const shortHours = this.config.get('JWT_REFRESH_SHORT_TTL_HOURS', {
      infer: true,
    });
    this.refreshShortTtlMs = shortHours * 60 * 60 * 1000;
    const absDays = this.config.get('JWT_REFRESH_ABSOLUTE_TTL_DAYS', {
      infer: true,
    });
    this.refreshAbsoluteTtlMs = absDays * 24 * 60 * 60 * 1000;
    const idleDays = this.config.get('JWT_REFRESH_IDLE_TTL_DAYS', {
      infer: true,
    });
    this.refreshIdleTtlMs = idleDays * 24 * 60 * 60 * 1000;
  }

  async issueTokenPair(
    user: UserRow,
    ctx: RequestContext = {},
    familyId?: string,
    options: IssueOptions = {},
  ): Promise<IssuedTokenPair> {
    const refreshSecret = this.generateRefreshSecret();
    const rememberMe = options.rememberMe ?? true;
    const now = Date.now();
    const ttlMs = rememberMe ? this.refreshTtlMs : this.refreshShortTtlMs;
    const refreshExpiresAt = new Date(now + ttlMs);
    const absoluteExpiresAt =
      options.absoluteExpiresAt ?? new Date(now + this.refreshAbsoluteTtlMs);
    if (refreshExpiresAt > absoluteExpiresAt) {
      refreshExpiresAt.setTime(absoluteExpiresAt.getTime());
    }

    const id = randomUUID();
    const family = familyId ?? randomUUID();

    await this.db.transaction(async (tx) => {
      if (options.revokeOthers) {
        await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(refreshTokens.userId, user.id),
              isNull(refreshTokens.revokedAt),
            ),
          );
      }
      await tx.insert(refreshTokens).values({
        id,
        userId: user.id,
        familyId: family,
        tokenHash: sha256(refreshSecret),
        expiresAt: refreshExpiresAt,
        absoluteExpiresAt,
        rememberMe,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
      });
    });

    const accessToken = await this.signAccessToken(user, id);
    const accessExp = this.computeAccessExpiry();

    return {
      accessToken,
      refreshToken: this.encodeRefreshToken(id, refreshSecret),
      accessTokenExpiresAt: accessExp.toISOString(),
      refreshTokenExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  async rotateRefreshToken(
    rawToken: string,
    ctx: RequestContext = {},
  ): Promise<{ user: UserRow; tokens: IssuedTokenPair }> {
    const parsed = this.decodeRefreshToken(rawToken);
    if (!parsed) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, parsed.id))
      .limit(1);

    if (!row || row.tokenHash !== sha256(parsed.secret)) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (row.revokedAt) {
      this.logger.warn(
        `Refresh token reuse detected for user ${row.userId}, revoking family ${row.familyId}`,
      );
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Refresh token reused');
    }

    const now = Date.now();
    if (row.expiresAt.getTime() <= now) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (row.absoluteExpiresAt && row.absoluteExpiresAt.getTime() <= now) {
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Session lifetime exceeded');
    }
    if (
      row.lastUsedAt &&
      now - row.lastUsedAt.getTime() > this.refreshIdleTtlMs
    ) {
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException('Session idle timeout');
    }

    const user = await this.loadUser(row.userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException('User is not active');
    }

    const tokens = await this.issueTokenPair(user, ctx, row.familyId, {
      rememberMe: row.rememberMe ?? true,
      absoluteExpiresAt: row.absoluteExpiresAt ?? undefined,
    });

    const newId = this.decodeRefreshToken(tokens.refreshToken)!.id;
    await this.db
      .update(refreshTokens)
      .set({
        revokedAt: new Date(),
        replacedById: newId,
        lastUsedAt: new Date(),
      })
      .where(eq(refreshTokens.id, row.id));

    return { user, tokens };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const parsed = this.decodeRefreshToken(rawToken);
    if (!parsed) {
      return;
    }
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, parsed.id))
      .limit(1);
    if (!row || row.tokenHash !== sha256(parsed.secret)) {
      return;
    }
    if (!row.revokedAt) {
      await this.db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.id, row.id));
    }
  }

  async listActiveSessions(userId: string): Promise<RefreshTokenRow[]> {
    return this.db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, userId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      );
  }

  async listSessionsForUser(userId: string): Promise<RefreshTokenRow[]> {
    return this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
  }

  async revokeSessionById(
    sessionId: string,
    expectedUserId?: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, sessionId))
      .limit(1);
    if (!row) return false;
    if (expectedUserId && row.userId !== expectedUserId) return false;
    if (row.revokedAt) return true;
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, sessionId));
    return true;
  }

  async isSessionActive(sid: string, userId?: string): Promise<boolean> {
    if (!sid || !/^[0-9a-f-]{36}$/i.test(sid)) return false;
    const [row] = await this.db
      .select({
        userId: refreshTokens.userId,
        revokedAt: refreshTokens.revokedAt,
        expiresAt: refreshTokens.expiresAt,
      })
      .from(refreshTokens)
      .where(eq(refreshTokens.id, sid))
      .limit(1);
    if (!row) return false;
    if (userId && row.userId !== userId) return false;
    if (row.revokedAt) return false;
    if (row.expiresAt.getTime() <= Date.now()) return false;
    return true;
  }

  async revokeAllForUser(
    userId: string,
    exceptSessionId?: string,
    tx?: DbExecutor,
  ): Promise<number> {
    const exec = tx ?? this.db;
    const conds = [
      eq(refreshTokens.userId, userId),
      isNull(refreshTokens.revokedAt),
    ];
    const updated = await exec
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(...conds))
      .returning({ id: refreshTokens.id });
    if (exceptSessionId) {
      const filtered = updated.filter((r) => r.id !== exceptSessionId);
      if (filtered.length !== updated.length) {
        await exec
          .update(refreshTokens)
          .set({ revokedAt: null })
          .where(eq(refreshTokens.id, exceptSessionId));
      }
      return filtered.length;
    }
    return updated.length;
  }

  private async loadUser(userId: string): Promise<UserRow | null> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ?? null;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  private async signAccessToken(user: UserRow, sid: string): Promise<string> {
    const payload: JwtAccessPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sid,
    };
    return this.jwt.signAsync(payload, {
      secret: this.accessSecret,
      expiresIn: this.accessTtl as unknown as number,
    });
  }

  private computeAccessExpiry(): Date {
    const ms = parseDurationMs(this.accessTtl);
    return new Date(Date.now() + ms);
  }

  private generateRefreshSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  private encodeRefreshToken(id: string, secret: string): string {
    return `${id}.${secret}`;
  }

  private decodeRefreshToken(
    raw: string,
  ): { id: string; secret: string } | null {
    const idx = raw.indexOf('.');
    if (idx <= 0 || idx === raw.length - 1) return null;
    const id = raw.slice(0, idx);
    const secret = raw.slice(idx + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { id, secret };
  }
}

export function parseDurationMs(input: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${input}`);
  }
  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return value * multipliers[unit];
}
