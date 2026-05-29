import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import {
  CoinPackagesService,
  toPublicCoinPackage,
  type PublicCoinPackage,
} from './coin-packages.service';
import {
  DailyBonusService,
  type DailyBonusClaimResult,
} from './daily-bonus.service';
import { DepositsService, type CreateCheckoutResult } from './deposits.service';
import {
  CreateCheckoutDto,
  RedeemPromoDto,
  SimulatePaymentDto,
} from './dto/wallet.dto';
import { IdempotencyKey } from './idempotency.decorator';
import {
  PromoCodesService,
  type PromoRedeemResult,
} from './promo-codes.service';
import { WalletService, type WalletOverview } from './wallet.service';

@Controller({ path: 'wallet', version: '1' })
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly packages: CoinPackagesService,
    private readonly deposits: DepositsService,
    private readonly dailyBonus: DailyBonusService,
    private readonly promo: PromoCodesService,
    private readonly users: UsersService,
  ) {}

  @Get('overview')
  async overview(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WalletOverview> {
    const row = await this.users.findById(user.id);
    if (!row) throw new NotFoundException('User not found');
    return this.wallet.getOverview(row);
  }

  @Get('packages')
  async listPackages(): Promise<{ packages: PublicCoinPackage[] }> {
    const rows = await this.packages.listActive();
    return { packages: rows.map(toPublicCoinPackage) };
  }

  @Post('checkout')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async createCheckout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateCheckoutDto,
    @IdempotencyKey() idemKey: string,
  ): Promise<CreateCheckoutResult> {
    const row = await this.users.findById(user.id);
    if (!row) throw new NotFoundException('User not found');
    this.wallet.assertMoneyActionAllowed(row);
    return this.deposits.createCheckout(row, body, idemKey);
  }

  @Post('daily-bonus/claim')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async claimDailyBonus(
    @CurrentUser() user: AuthenticatedUser,
    @IdempotencyKey() idemKey: string,
  ): Promise<DailyBonusClaimResult> {
    const row = await this.users.findById(user.id);
    if (!row) throw new NotFoundException('User not found');
    this.wallet.assertMoneyActionAllowed(row);
    return this.dailyBonus.claim(row.id, idemKey);
  }

  @Post('checkout/:id/simulate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async simulatePayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() body: SimulatePaymentDto,
  ): Promise<{ status: string; depositIntentId: string }> {
    const row = await this.users.findById(user.id);
    if (!row) throw new NotFoundException('User not found');
    this.wallet.assertMoneyActionAllowed(row);
    const refreshed = await this.deposits.simulatePayment(
      row,
      id,
      body.outcome,
    );
    return { status: refreshed.status, depositIntentId: refreshed.id };
  }

  @Post('promo/redeem')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async redeemPromo(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: RedeemPromoDto,
    @IdempotencyKey() idemKey: string,
  ): Promise<PromoRedeemResult> {
    const row = await this.users.findById(user.id);
    if (!row) throw new NotFoundException('User not found');
    this.wallet.assertMoneyActionAllowed(row);
    return this.promo.redeem(row.id, body.code, idemKey);
  }
}
