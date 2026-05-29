import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { StreamersController } from './streamers.controller';
import { StreamersService } from './streamers.service';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => UsersModule)],
  controllers: [StreamersController],
  providers: [StreamersService],
  exports: [StreamersService],
})
export class StreamersModule {}
