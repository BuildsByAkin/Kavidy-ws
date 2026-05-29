import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { Env } from '../../config/env';
import type { JwtAccessPayload } from '../tokens.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  validate(payload: JwtAccessPayload): AuthenticatedUser {
    if (!payload?.sub || !payload?.email || !payload?.role || !payload?.sid) {
      throw new UnauthorizedException();
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      sessionId: payload.sid,
    };
  }
}
