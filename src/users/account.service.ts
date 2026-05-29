import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TokensService } from '../auth/tokens.service';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
  type UserRow,
} from '../database/schema/users';
import { LedgerService } from '../wallet/ledger.service';
import { toPublicUser, type PublicUser } from './users.mapper';
import { normalizeEmail, UsersService } from './users.service';

export interface UpdateNotificationPrefsInput {
  emailDigest?: boolean;
  marketAlerts?: boolean;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
    private readonly ledger: LedgerService,
  ) {}

  async updateDisplayName(
    userId: string,
    displayName: string,
  ): Promise<PublicUser> {
    const trimmed = displayName.trim();
    const me = await this.requireUser(userId);

    if (
      me.displayName &&
      me.displayName.toLowerCase() === trimmed.toLowerCase()
    ) {
      return toPublicUser(me);
    }

    const existing = await this.users.findByDisplayName(trimmed);
    if (existing && existing.id !== userId) {
      throw new ConflictException({
        code: 'DISPLAY_NAME_TAKEN',
        message: 'Display name is already taken',
      });
    }

    try {
      const updated = await this.users.updateDisplayName(userId, trimmed);
      return toPublicUser(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'DISPLAY_NAME_TAKEN',
          message: 'Display name is already taken',
        });
      }
      throw err;
    }
  }

  async updateEmail(userId: string, email: string): Promise<PublicUser> {
    const normalized = normalizeEmail(email);
    const me = await this.requireUser(userId);

    if (me.email.toLowerCase() === normalized) {
      return toPublicUser(me);
    }

    const existing = await this.users.findByEmail(normalized);
    if (existing && existing.id !== userId) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'Email is already in use',
      });
    }

    try {
      const updated = await this.db.transaction(async (tx) => {
        const row = await this.users.updateEmail(userId, normalized, tx);
        await this.tokens.revokeAllForUser(userId, undefined, tx);
        return row;
      });
      this.logger.log(`Email changed for user ${userId}`);
      return toPublicUser(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({
          code: 'EMAIL_TAKEN',
          message: 'Email is already in use',
        });
      }
      throw err;
    }
  }

  async updateNotificationPrefs(
    userId: string,
    input: UpdateNotificationPrefsInput,
  ): Promise<PublicUser> {
    const me = await this.requireUser(userId);
    const current: NotificationPrefs =
      me.notificationPrefs ?? DEFAULT_NOTIFICATION_PREFS;
    const next: NotificationPrefs = {
      emailDigest: input.emailDigest ?? current.emailDigest,
      marketAlerts: input.marketAlerts ?? current.marketAlerts,
    };
    const updated = await this.users.updateNotificationPrefs(userId, next);
    return toPublicUser(updated);
  }

  async deleteAccount(userId: string, confirmHandle: string): Promise<void> {
    const me = await this.requireUser(userId);
    if (me.status === 'deleted') {
      throw new NotFoundException('User not found');
    }
    if (confirmHandle.trim().toLowerCase() !== me.username.toLowerCase()) {
      throw new BadRequestException({
        code: 'HANDLE_CONFIRMATION_MISMATCH',
        message: 'Handle confirmation does not match your username',
      });
    }

    const balance = await this.ledger.getBalance(userId);
    if (balance.sweepsCashableCents > 0) {
      throw new UnprocessableEntityException({
        code: 'CASHABLE_BALANCE_REMAINING',
        message:
          'Cash out or redeem your Sweeps Coins balance before deleting your account',
      });
    }

    await this.db.transaction(async (tx) => {
      await this.users.softDeleteAccount(userId, tx);
      await this.tokens.revokeAllForUser(userId, undefined, tx);
    });
    this.logger.warn(`Account soft-deleted for user ${userId}`);
  }

  private async requireUser(userId: string): Promise<UserRow> {
    const row = await this.users.findById(userId);
    if (!row) {
      throw new NotFoundException('User not found');
    }
    return row;
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
