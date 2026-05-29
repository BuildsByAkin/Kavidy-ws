import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import type { Env } from '../config/env';
import { AuthService, type AuthResult } from './auth.service';
import {
  TOKEN_DELIVERY_HEADER,
  authCookieContext,
  clearAuthCookies,
  readRefreshCookie,
  setRefreshCookie,
} from './cookies';
import { SkipOnboarding } from './decorators/skip-onboarding.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  GoogleDto,
  LoginDto,
  LogoutDto,
  OnboardDto,
  RefreshDto,
  ResetPasswordDto,
  SignupDto,
} from './dto/auth.dto';
import { CsrfGuard } from './guards/csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import type { RequestContext } from './tokens.service';
import type { PublicUser } from '../users/users.mapper';

function ctxOf(req: Request): RequestContext {
  return {
    userAgent: req.headers['user-agent'] ?? null,
    ipAddress: req.ip ?? null,
  };
}

function deliveryMode(req: Request): 'cookie' | 'body' {
  const raw = req.headers[TOKEN_DELIVERY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.toLowerCase() === 'body' ? 'body' : 'cookie';
}

export interface AuthResponseBody {
  user: PublicUser;
  tokens: {
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshTokenExpiresAt: string;
    refreshToken?: string;
  };
}

@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signup(
    @Body() body: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseBody> {
    const result = await this.auth.signup(body, ctxOf(req));
    return this.respond(req, res, result, body.rememberMe ?? true);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async login(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseBody> {
    const result = await this.auth.login(body, ctxOf(req));
    return this.respond(req, res, result, body.rememberMe ?? true);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async google(
    @Body() body: GoogleDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseBody> {
    const result = await this.auth.loginWithGoogle(body, ctxOf(req));
    return this.respond(req, res, result, body.rememberMe ?? true);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseBody> {
    const cookieToken = readRefreshCookie(req, authCookieContext(this.config));
    const refreshToken = body.refreshToken ?? cookieToken;
    if (!refreshToken) {
      throw new BadRequestException({
        code: 'REFRESH_TOKEN_REQUIRED',
        message: 'Refresh token is required',
      });
    }
    const result = await this.auth.refresh(refreshToken, ctxOf(req));
    const usedCookie = !body.refreshToken && !!cookieToken;
    return this.respond(req, res, result, true, usedCookie);
  }

  @Post('logout')
  @SkipOnboarding()
  @UseGuards(CsrfGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() body: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const cookieToken = readRefreshCookie(req, authCookieContext(this.config));
    const refreshToken = body.refreshToken ?? cookieToken;
    if (refreshToken) {
      await this.auth.logout(refreshToken);
    }
    clearAuthCookies(res, authCookieContext(this.config));
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
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.confirmPasswordReset(body.token, body.password);
    clearAuthCookies(res, authCookieContext(this.config));
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
    clearAuthCookies(res, authCookieContext(this.config));
  }

  @Post('onboard')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @SkipOnboarding()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  onboard(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: OnboardDto,
  ): Promise<PublicUser> {
    return this.auth.onboard(user.id, body);
  }

  private respond(
    req: Request,
    res: Response,
    result: AuthResult,
    rememberMe: boolean,
    forceCookie = false,
  ): AuthResponseBody {
    const mode = forceCookie ? 'cookie' : deliveryMode(req);
    const cookieCtx = authCookieContext(this.config);
    const tokens: AuthResponseBody['tokens'] = {
      accessToken: result.tokens.accessToken,
      accessTokenExpiresAt: result.tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: result.tokens.refreshTokenExpiresAt,
    };

    if (mode === 'cookie') {
      setRefreshCookie(res, cookieCtx, result.tokens.refreshToken, {
        rememberMe,
        expiresAt: new Date(result.tokens.refreshTokenExpiresAt),
      });
    } else {
      tokens.refreshToken = result.tokens.refreshToken;
    }
    return { user: result.user, tokens };
  }
}
