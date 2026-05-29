import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from '../../users/users.service';
import { SKIP_ONBOARDING_KEY } from '../decorators/skip-onboarding.decorator';
import { TokensService } from '../tokens.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
    private readonly tokens: TokensService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = (await super.canActivate(context)) as boolean;
    if (!ok) return false;

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const auth = req.user;
    if (!auth) return true;

    if (!auth.sessionId) {
      throw new UnauthorizedException({
        code: 'SESSION_INVALID',
        message: 'Session is no longer valid',
      });
    }
    const active = await this.tokens.isSessionActive(auth.sessionId, auth.id);
    if (!active) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'Signed out because you logged in on another device',
      });
    }

    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_ONBOARDING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const user = await this.users.findById(auth.id);
    if (user && user.onboardingStatus === 'incomplete') {
      throw new ForbiddenException({
        code: 'ONBOARDING_REQUIRED',
        message: 'Complete onboarding to continue',
      });
    }
    return true;
  }
}
