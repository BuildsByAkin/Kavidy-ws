import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../config/env';

@Injectable()
export class WorkerApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-api-key'];
    const expected = this.config.get('MARKETS_WORKER_API_KEY', { infer: true });

    if (!provided || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing worker API key');
    }
    return true;
  }
}
