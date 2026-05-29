import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OAuth2Client,
  type LoginTicket,
  type TokenPayload,
} from 'google-auth-library';
import type { Env } from '../config/env';

export interface VerifiedGoogleIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  givenName: string | null;
  familyName: string | null;
  picture: string | null;
  raw: TokenPayload;
}

@Injectable()
export class GoogleService {
  private readonly logger = new Logger(GoogleService.name);
  private readonly client: OAuth2Client;
  private readonly audience: string[];

  constructor(config: ConfigService<Env, true>) {
    this.audience = config.get('GOOGLE_CLIENT_IDS', { infer: true });
    this.client = new OAuth2Client();
  }

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    let ticket: LoginTicket;
    try {
      ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audience,
      });
    } catch (err) {
      this.logger.warn(`Google ID token verification failed: ${String(err)}`);
      throw new UnauthorizedException('Invalid Google credential');
    }

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new UnauthorizedException('Invalid Google credential');
    }
    if (payload.email_verified !== true) {
      throw new UnauthorizedException('Google email not verified');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified,
      name: payload.name ?? null,
      givenName: payload.given_name ?? null,
      familyName: payload.family_name ?? null,
      picture: payload.picture ?? null,
      raw: payload,
    };
  }
}
