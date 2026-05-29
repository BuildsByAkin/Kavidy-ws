import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CoinPackagesService } from './coin-packages.service';
import { DailyBonusService } from './daily-bonus.service';
import { DepositsService } from './deposits.service';
import { IdempotencyService } from './idempotency.service';
import { LedgerService } from './ledger.service';
import { PaymentsService } from './payments.service';
import { PromoCodesService } from './promo-codes.service';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [WalletController],
  providers: [
    LedgerService,
    IdempotencyService,
    CoinPackagesService,
    DailyBonusService,
    PromoCodesService,
    PaymentsService,
    DepositsService,
    WalletService,
  ],
  exports: [
    LedgerService,
    WalletService,
    CoinPackagesService,
    DailyBonusService,
    PromoCodesService,
    DepositsService,
    IdempotencyService,
  ],
})
export class WalletModule {}
