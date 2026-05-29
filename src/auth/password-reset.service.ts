import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import { EmailService } from '../common/email/email.service';
import type { Env } from '../config/env';
import {
  DRIZZLE,
  type Database,
  type DbExecutor,
} from '../database/database.module';
import {
  passwordResetTokens,
  type PasswordResetTokenRow,
} from '../database/schema/password-reset-tokens';
import type { UserRow } from '../database/schema/users';
import type { RequestContext } from './tokens.service';

const RESET_TTL_MS = 30 * 60 * 1000;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly resetBaseUrl: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.resetBaseUrl = this.config.get('PASSWORD_RESET_URL', { infer: true });
  }

  async createAndSend(user: UserRow, ctx: RequestContext = {}): Promise<void> {
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, user.id),
          isNull(passwordResetTokens.usedAt),
        ),
      );

    const secret = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await this.db.insert(passwordResetTokens).values({
      id,
      userId: user.id,
      tokenHash: sha256(secret),
      expiresAt,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    });

    const token = `${id}.${secret}`;
    const url = `${this.resetBaseUrl}?token=${encodeURIComponent(token)}`;
    await this.email.sendPasswordReset({
      to: user.email,
      resetUrl: url,
      token,
      expiresAt,
    });
    this.logger.log(`Issued password reset token for user ${user.id}`);
  }

  async consume(
    rawToken: string,
    tx?: DbExecutor,
  ): Promise<PasswordResetTokenRow> {
    const parsed = this.decode(rawToken);
    if (!parsed) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    const exec = tx ?? this.db;
    const [row] = await exec
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.id, parsed.id))
      .limit(1);
    if (!row || row.tokenHash !== sha256(parsed.secret)) {
      throw new BadRequestException('Invalid or expired reset token');
    }
    if (row.usedAt) {
      throw new BadRequestException('Reset token already used');
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Reset token expired');
    }
    const [updated] = await exec
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id))
      .returning();
    return updated;
  }

  private decode(raw: string): { id: string; secret: string } | null {
    const idx = raw.indexOf('.');
    if (idx <= 0 || idx === raw.length - 1) return null;
    const id = raw.slice(0, idx);
    const secret = raw.slice(idx + 1);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { id, secret };
  }
}
