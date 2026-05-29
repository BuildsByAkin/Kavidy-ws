import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
interface HeaderRequest {
  headers: Record<string, string | string[] | undefined>;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<HeaderRequest>();
    const raw = req.headers['idempotency-key'];
    const value: string = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
    if (!value) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (!KEY_PATTERN.test(value)) {
      throw new BadRequestException(
        'Idempotency-Key must be 8-128 chars, [A-Za-z0-9_-]',
      );
    }
    return value;
  },
);
