import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { WorkerApiKeyGuard } from '../common/guards/worker-api-key.guard';
import { BetsController } from './bets.controller';
import { BetsService } from './bets.service';
import { BetsSettlementService } from './bets.settlement.service';
import { MarketExposureService } from './market-exposure.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    WalletModule,
  ],
  controllers: [BetsController],
  providers: [BetsService, BetsSettlementService, MarketExposureService, WorkerApiKeyGuard],
  exports: [BetsService, BetsSettlementService, MarketExposureService],
})
export class BetsModule {}
