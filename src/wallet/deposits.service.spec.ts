import { NotFoundException } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import { PaymentsService } from './payments.service';

interface Intent {
  id: string;
  userId: string;
  packageId: number;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  priceCents: number;
  baseSweepsCents: number;
  bonusSweepsCents: number;
  firstPurchaseApplied: boolean;
  promoCode: string | null;
  promoSweepsCents: number;
  providerSessionId: string | null;
  providerPaymentRef: string | null;
  providerEventId: string | null;
  idempotencyKey: string;
  metadata: Record<string, unknown> | null;
  completedAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function makeDb() {
  const intents: Intent[] = [];
  let countMode = false;

  const db: any = {
    intents,
    select(cols?: any) {
      countMode = Boolean(cols?.value);
      return {
        from: () => ({
          where: () => makeChain(),
          orderBy: () => ({ limit: async () => intents.slice() }),
        }),
      };
    },
    update() {
      return {
        set: (patch: any) => ({
          where: () => ({
            returning: async () => {
              for (const i of intents) Object.assign(i, patch);
              return intents.slice();
            },
            then(onFul: any, onRej: any) {
              try {
                for (const i of intents) {
                  if (
                    patch.status &&
                    patch.status !== 'completed' &&
                    i.status !== 'pending'
                  ) {
                    continue;
                  }
                  Object.assign(i, patch);
                }
                return Promise.resolve(undefined).then(onFul, onRej);
              } catch (e) {
                return Promise.reject(e as Error).then(onFul, onRej);
              }
            },
          }),
        }),
      };
    },
    transaction: async (fn: any) => fn(db),
  };

  db.insert = (_table: any) => ({
    values: (v: any) => ({
      returning: async () => {
        const row = makeIntentRow(v);
        intents.push(row);
        return [row];
      },
    }),
  });

  function makeChain(): any {
    return {
      for: () => ({
        limit: async () => intents.slice(0, 1),
      }),
      limit: async () => {
        if (countMode) {
          const n = intents.filter((i) => i.status === 'completed').length;
          countMode = false;
          return [{ value: n }];
        }
        return intents.slice(0, 1);
      },
      orderBy: () => ({
        limit: async () => intents.slice(),
      }),
      then(onFul: any, onRej: any) {
        if (countMode) {
          const n = intents.filter((i) => i.status === 'completed').length;
          countMode = false;
          return Promise.resolve([{ value: n }]).then(onFul, onRej);
        }
        return Promise.resolve(intents.slice(0, 1)).then(onFul, onRej);
      },
    };
  }

  function makeIntentRow(v: any): Intent {
    return {
      id: v.id,
      userId: v.userId,
      packageId: v.packageId,
      status: v.status ?? 'pending',
      priceCents: v.priceCents,
      baseSweepsCents: v.baseSweepsCents ?? 0,
      bonusSweepsCents: v.bonusSweepsCents ?? 0,
      firstPurchaseApplied: v.firstPurchaseApplied ?? false,
      promoCode: v.promoCode ?? null,
      promoSweepsCents: v.promoSweepsCents ?? 0,
      providerSessionId: v.providerSessionId ?? null,
      providerPaymentRef: v.providerPaymentRef ?? null,
      providerEventId: v.providerEventId ?? null,
      idempotencyKey: v.idempotencyKey,
      metadata: v.metadata ?? null,
      completedAt: null,
      failedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return db;
}

function makeConfig() {
  return {
    get: (key: string) => {
      if (key === 'PAYMENT_SUCCESS_URL') return 'http://localhost/success';
      if (key === 'PAYMENT_CANCEL_URL') return 'http://localhost/cancel';
      return '';
    },
  };
}

const pkg = {
  id: 1,
  code: 'pro',
  name: 'Pro',
  description: null,
  priceCents: 1999,
  sweepsCents: 2500,
  bonusPercent: 10,
  badge: null,
  sortOrder: 30,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const user = {
  id: 'user-1',
  email: 'a@b.com',
  username: 'alice',
  country: 'US',
  state: 'CA',
  dateOfBirth: '1990-01-01',
} as any;

function setup() {
  const db = makeDb();
  const config = makeConfig();
  const packages = {
    getActiveByIdOrThrow: jest.fn(async () => pkg),
  };
  const payments = new PaymentsService();
  const ledger = {
    post: jest.fn(async () => ({
      snapshot: {} as any,
      balanceAfter: 0,
      ledgerId: 'l',
    })),
  };
  const svc = new DepositsService(
    db,
    config as any,
    packages as any,
    payments,
    ledger as any,
  );
  return { svc, db, packages, ledger };
}

describe('DepositsService', () => {
  it('reports first-purchase offer when no completed intents exist', async () => {
    const { svc } = setup();
    const offer = await svc.getFirstPurchaseOffer(user.id);
    expect(offer.available).toBe(true);
    expect(offer.multiplier).toBe(2);
  });

  it('creates a checkout with first-purchase bonus on first deposit', async () => {
    const { svc, db } = setup();
    const out = await svc.createCheckout(
      user,
      { packageId: pkg.id },
      'idem-key-1',
    );
    expect(out.priceCents).toBe(1999);
    expect(out.baseSweepsCents).toBe(2500);
    expect(out.bonusSweepsCents).toBe(2500);
    expect(out.firstPurchaseApplied).toBe(true);
    expect(out.providerSessionId).toMatch(/^mock_sess_/);
    expect(out.checkoutUrl).toContain(out.providerSessionId);
    expect(db.intents).toHaveLength(1);
    expect(db.intents[0].providerSessionId).toBe(out.providerSessionId);
  });

  it('returns the existing intent when the same idempotency key is reused', async () => {
    const { svc } = setup();
    const a = await svc.createCheckout(user, { packageId: pkg.id }, 'dup-key');
    const b = await svc.createCheckout(user, { packageId: pkg.id }, 'dup-key');
    expect(b.depositIntentId).toBe(a.depositIntentId);
    expect(b.providerSessionId).toBe(a.providerSessionId);
  });

  it('handleProviderEvent credits base sweeps_locked and first-purchase bonus', async () => {
    const { svc, db, ledger } = setup();
    const created = await svc.createCheckout(
      user,
      { packageId: pkg.id },
      'idem-2',
    );
    const event = {
      id: 'evt-1',
      type: 'session.completed' as const,
      sessionId: created.providerSessionId,
      depositIntentId: created.depositIntentId,
      amountCents: 1999,
      paymentRef: 'pi_1',
    };
    await svc.handleProviderEvent(event);
    const intent = db.intents.find(
      (i: Intent) => i.id === created.depositIntentId,
    );
    expect(intent?.status).toBe('completed');
    expect(intent?.providerEventId).toBe('evt-1');
    expect(intent?.providerPaymentRef).toBe('pi_1');
    const kinds = ledger.post.mock.calls.map((c) => (c as any[])[0].kind);
    expect(kinds).toContain('deposit_purchase');
    expect(kinds).toContain('deposit_first_purchase_bonus');
    expect(ledger.post).toHaveBeenCalledTimes(2);
  });

  it('rejects amount-mismatched events and marks intent failed', async () => {
    const { svc, db, ledger } = setup();
    const created = await svc.createCheckout(
      user,
      { packageId: pkg.id },
      'idem-3',
    );
    await svc.handleProviderEvent({
      id: 'evt-bad',
      type: 'session.completed',
      sessionId: created.providerSessionId,
      depositIntentId: created.depositIntentId,
      amountCents: 1,
      paymentRef: 'pi_bad',
    });
    const intent = db.intents.find(
      (i: Intent) => i.id === created.depositIntentId,
    );
    expect(intent?.status).toBe('failed');
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('simulatePayment blocks access from another user', async () => {
    const { svc } = setup();
    const created = await svc.createCheckout(
      user,
      { packageId: pkg.id },
      'idem-4',
    );
    await expect(
      svc.simulatePayment(
        { ...user, id: 'other-user' },
        created.depositIntentId,
        'completed',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('simulatePayment completes the deposit on outcome=completed', async () => {
    const { svc, db } = setup();
    const created = await svc.createCheckout(
      user,
      { packageId: pkg.id },
      'idem-5',
    );
    const out = await svc.simulatePayment(
      user,
      created.depositIntentId,
      'completed',
    );
    expect(out.status).toBe('completed');
    const intent = db.intents.find(
      (i: Intent) => i.id === created.depositIntentId,
    );
    expect(intent?.providerEventId).toMatch(/^mock_evt_/);
  });

  it('simulatePayment marks intent expired on outcome=expired', async () => {
    const { svc, db } = setup();
    const created = await svc.createCheckout(
      user,
      { packageId: pkg.id },
      'idem-6',
    );
    const out = await svc.simulatePayment(
      user,
      created.depositIntentId,
      'expired',
    );
    expect(out.status).toBe('expired');
    const intent = db.intents.find(
      (i: Intent) => i.id === created.depositIntentId,
    );
    expect(intent?.failedAt).toBeInstanceOf(Date);
  });

  it('first-purchase offer flips off after a completed intent', async () => {
    const { svc } = setup();
    const created = await svc.createCheckout(
      user,
      { packageId: pkg.id },
      'idem-7',
    );
    await svc.simulatePayment(user, created.depositIntentId, 'completed');
    const offer = await svc.getFirstPurchaseOffer(user.id);
    expect(offer.available).toBe(false);
  });
});
