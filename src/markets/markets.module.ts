import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BetsModule } from '../bets/bets.module';
import { WorkerApiKeyGuard } from '../common/guards/worker-api-key.guard';
import { UsersModule } from '../users/users.module';
import { MarketsEventsService } from './markets-events.service';
import { MarketsController } from './markets.controller';
import { MarketsService } from './markets.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    BetsModule,
  ],
  controllers: [MarketsController],
  providers: [MarketsService, MarketsEventsService, WorkerApiKeyGuard],
  exports: [MarketsService, MarketsEventsService],
})
export class MarketsModule {}
