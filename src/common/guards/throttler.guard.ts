import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class KavidyThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, unknown>): Promise<string> {
    const user = req.user as { id?: string } | undefined;
    if (user?.id) {
      return Promise.resolve(`user:${user.id}`);
    }
    const xff = req.headers as Record<string, string | string[] | undefined>;
    const forwarded = xff?.['x-forwarded-for'];
    const ipFromHeader = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
        ? forwarded.split(',')[0]?.trim()
        : undefined;
    const ip = (req.ip as string | undefined) ?? ipFromHeader ?? 'unknown';
    return Promise.resolve(`ip:${ip}`);
  }
}
