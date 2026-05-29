import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { UsersService } from '../../users/users.service';
import type { TokensService } from '../tokens.service';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeCtx(user?: AuthenticatedUser): ExecutionContext {
  const req: any = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeGuard(opts: {
  superOk?: boolean;
  isSessionActive?: jest.Mock;
  findById?: jest.Mock;
  skip?: boolean;
}): JwtAuthGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.skip ?? false),
  } as unknown as Reflector;
  const users = {
    findById: opts.findById ?? jest.fn().mockResolvedValue(null),
  } as unknown as UsersService;
  const tokens = {
    isSessionActive: opts.isSessionActive ?? jest.fn().mockResolvedValue(true),
  } as unknown as TokensService;
  const guard = new JwtAuthGuard(reflector, users, tokens);
  jest
    .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
    .mockResolvedValue(opts.superOk ?? true);
  return guard;
}

describe('JwtAuthGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  it('returns false when passport guard fails', async () => {
    const guard = makeGuard({ superOk: false });
    await expect(guard.canActivate(makeCtx())).resolves.toBe(false);
  });

  it('allows when no user attached (defensive no-op)', async () => {
    const guard = makeGuard({});
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true);
  });

  it('throws UnauthorizedException when sessionId is missing', async () => {
    const guard = makeGuard({});
    const ctx = makeCtx({ id: 'u1', email: 'a@b.c', role: 'user' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when session is revoked', async () => {
    const isSessionActive = jest.fn().mockResolvedValue(false);
    const guard = makeGuard({ isSessionActive });
    const ctx = makeCtx({
      id: 'u1',
      email: 'a@b.c',
      role: 'user',
      sessionId: 'sid-1',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(isSessionActive).toHaveBeenCalledWith('sid-1', 'u1');
  });

  it('throws ForbiddenException ONBOARDING_REQUIRED when user is incomplete', async () => {
    const findById = jest
      .fn()
      .mockResolvedValue({ onboardingStatus: 'incomplete' });
    const guard = makeGuard({ findById });
    const ctx = makeCtx({
      id: 'u1',
      email: 'a@b.c',
      role: 'user',
      sessionId: 'sid-1',
    });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('skips onboarding check when SkipOnboarding is set', async () => {
    const findById = jest.fn();
    const guard = makeGuard({ skip: true, findById });
    const ctx = makeCtx({
      id: 'u1',
      email: 'a@b.c',
      role: 'user',
      sessionId: 'sid-1',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(findById).not.toHaveBeenCalled();
  });

  it('allows active session with completed onboarding', async () => {
    const findById = jest
      .fn()
      .mockResolvedValue({ onboardingStatus: 'active' });
    const guard = makeGuard({ findById });
    const ctx = makeCtx({
      id: 'u1',
      email: 'a@b.c',
      role: 'user',
      sessionId: 'sid-1',
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
