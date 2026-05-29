import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import {
  AdminSessionsController,
  SessionsController,
} from './sessions.controller';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SessionsController, AdminSessionsController],
})
export class SessionsModule {}
