import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { IdeasController } from './ideas.controller';
import { IdeasService } from './ideas.service';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => UsersModule)],
  controllers: [IdeasController],
  providers: [IdeasService],
  exports: [IdeasService],
})
export class IdeasModule {}
