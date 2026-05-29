import { KavidyThrottlerGuard } from './throttler.guard';

describe('KavidyThrottlerGuard.getTracker', () => {
  const guard = new KavidyThrottlerGuard(
    { throttlers: [] },
    { increment: jest.fn() } as never,
    { get: jest.fn(), getAllAndOverride: jest.fn() } as never,
  );

  const getTracker = (req: Record<string, unknown>) =>
    (guard as unknown as { getTracker: (r: any) => Promise<string> }).getTracker(
      req,
    );

  it('tracks authenticated users by user id', async () => {
    await expect(
      getTracker({ user: { id: 'u-123' }, ip: '1.2.3.4', headers: {} }),
    ).resolves.toBe('user:u-123');
  });

  it('falls back to req.ip for anonymous requests', async () => {
    await expect(getTracker({ ip: '9.9.9.9', headers: {} })).resolves.toBe(
      'ip:9.9.9.9',
    );
  });

  it('falls back to x-forwarded-for first hop when req.ip missing', async () => {
    await expect(
      getTracker({ headers: { 'x-forwarded-for': '8.8.8.8, 10.0.0.1' } }),
    ).resolves.toBe('ip:8.8.8.8');
  });

  it('returns ip:unknown when nothing is available', async () => {
    await expect(getTracker({ headers: {} })).resolves.toBe('ip:unknown');
  });
});
