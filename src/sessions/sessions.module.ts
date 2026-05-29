import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminSessionsController,
  SessionsController,
} from './sessions.controller';

@Module({
  imports: [AuthModule],
  controllers: [SessionsController, AdminSessionsController],
})
export class SessionsModule {}
