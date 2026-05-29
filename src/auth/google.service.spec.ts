import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleService } from './google.service';

function configWith(ids: string[]): ConfigService<any, true> {
  return {
    get: (key: string) => (key === 'GOOGLE_CLIENT_IDS' ? ids : undefined),
  } as any;
}

describe('GoogleService', () => {
  it('returns a verified identity on success', async () => {
    const svc = new GoogleService(configWith(['client-1']));
    (svc as any).client.verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({
        sub: 'g-1',
        email: 'a@b.com',
        email_verified: true,
        name: 'Name',
        given_name: 'Name',
        family_name: 'Last',
        picture: 'pic',
      }),
    });
    const out = await svc.verifyIdToken('tok');
    expect(out.sub).toBe('g-1');
    expect(out.email).toBe('a@b.com');
    expect(out.emailVerified).toBe(true);
  });

  it('rejects when verifyIdToken throws', async () => {
    const svc = new GoogleService(configWith(['client-1']));
    (svc as any).client.verifyIdToken = jest
      .fn()
      .mockRejectedValue(new Error('bad sig'));
    await expect(svc.verifyIdToken('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when payload missing', async () => {
    const svc = new GoogleService(configWith(['client-1']));
    (svc as any).client.verifyIdToken = jest
      .fn()
      .mockResolvedValue({ getPayload: () => undefined });
    await expect(svc.verifyIdToken('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects when email not verified', async () => {
    const svc = new GoogleService(configWith(['client-1']));
    (svc as any).client.verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({
        sub: 'g-1',
        email: 'a@b.com',
        email_verified: false,
      }),
    });
    await expect(svc.verifyIdToken('tok')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
