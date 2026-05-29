import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WalletModule } from '../wallet/wallet.module';
import { AccountService } from './account.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => WalletModule)],
  controllers: [UsersController],
  providers: [UsersService, AccountService],
  exports: [UsersService],
})
export class UsersModule {}
