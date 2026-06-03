import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkerApiKeyGuard } from './worker-api-key.guard';

const VALID_KEY = 'test-worker-key-that-is-at-least-32-chars-long!!';

function makeGuard(key = VALID_KEY) {
  const config = {
    get: jest.fn().mockReturnValue(key),
  } as unknown as ConfigService;
  return new WorkerApiKeyGuard(config as any);
}

function makeCtx(headerValue: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: headerValue !== undefined ? { 'x-api-key': headerValue } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('WorkerApiKeyGuard', () => {
  it('allows request with valid key', () => {
    const guard = makeGuard();
    expect(guard.canActivate(makeCtx(VALID_KEY))).toBe(true);
  });

  it('throws UnauthorizedException when key is missing', () => {
    const guard = makeGuard();
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when key is wrong', () => {
    const guard = makeGuard();
    expect(() => guard.canActivate(makeCtx('wrong-key'))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when key is empty string', () => {
    const guard = makeGuard();
    expect(() => guard.canActivate(makeCtx(''))).toThrow(UnauthorizedException);
  });
});
