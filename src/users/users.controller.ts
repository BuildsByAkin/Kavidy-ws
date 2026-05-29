import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Patch,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { authCookieContext, clearAuthCookies } from '../auth/cookies';
import { SkipOnboarding } from '../auth/decorators/skip-onboarding.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import type { Env } from '../config/env';
import { LedgerService, type BalanceSnapshot } from '../wallet/ledger.service';
import { AccountService } from './account.service';
import {
  DeleteAccountDto,
  UpdateDisplayNameDto,
  UpdateEmailDto,
  UpdateNotificationPrefsDto,
} from './dto/account.dto';
import { toPublicUser, type PublicUser } from './users.mapper';
import { UsersService } from './users.service';

export interface MeResponse {
  user: PublicUser;
  balances: BalanceSnapshot;
}

@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly ledger: LedgerService,
    private readonly account: AccountService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipOnboarding()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponse> {
    const row = await this.users.findById(user.id);
    if (!row) {
      throw new NotFoundException('User not found');
    }
    await this.ledger.ensureBalanceRow(row.id);
    const balances = await this.ledger.getBalance(row.id);
    return { user: toPublicUser(row), balances };
  }

  @Patch('me/profile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async updateDisplayName(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateDisplayNameDto,
  ): Promise<PublicUser> {
    return this.account.updateDisplayName(user.id, body.displayName);
  }

  @Patch('me/email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async updateEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateEmailDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicUser> {
    const updated = await this.account.updateEmail(user.id, body.email);
    clearAuthCookies(res, authCookieContext(this.config));
    return updated;
  }

  @Patch('me/notifications')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @SkipOnboarding()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async updateNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: UpdateNotificationPrefsDto,
  ): Promise<PublicUser> {
    return this.account.updateNotificationPrefs(user.id, body);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @SkipOnboarding()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DeleteAccountDto,
    @Req() _req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.account.deleteAccount(user.id, body.confirmHandle);
    clearAuthCookies(res, authCookieContext(this.config));
  }
}
