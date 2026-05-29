import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleService } from './google.service';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { PasswordResetService } from './password-reset.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokensService } from './tokens.service';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt', session: false }),
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokensService,
    GoogleService,
    PasswordResetService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    CsrfGuard,
  ],
  exports: [JwtAuthGuard, RolesGuard, CsrfGuard, AuthService, TokensService],
})
export class AuthModule {}
