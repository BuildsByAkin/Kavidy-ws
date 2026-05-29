import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { AuthService, type AuthResult } from './auth.service';
import {
  CompleteProfileDto,
  ForgotPasswordDto,
  GoogleDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { RequestContext } from './tokens.service';
import type { PublicUser } from '../users/users.mapper';

function ctxOf(req: Request): RequestContext {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? null,
  };
}

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signup(@Body() body: SignupDto, @Req() req: Request): Promise<AuthResult> {
    return this.auth.signup(body, ctxOf(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() body: LoginDto, @Req() req: Request): Promise<AuthResult> {
    return this.auth.login(body, ctxOf(req));
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  google(@Body() body: GoogleDto, @Req() req: Request): Promise<AuthResult> {
    return this.auth.loginWithGoogle(body, ctxOf(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() body: RefreshDto, @Req() req: Request): Promise<AuthResult> {
    return this.auth.refresh(body.refreshToken, ctxOf(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: LogoutDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    await this.auth.requestPasswordReset(body.email, ctxOf(req));
    return { ok: true };
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@Body() body: ResetPasswordDto): Promise<void> {
    await this.auth.confirmPasswordReset(body.token, body.password);
  }

  @Post('profile/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  completeProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CompleteProfileDto,
  ): Promise<PublicUser> {
    return this.auth.completeProfile(user.id, body);
  }
}
