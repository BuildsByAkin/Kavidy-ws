import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LedgerService } from './ledger.service';

interface BalanceState {
  userId: string;
  sweepsCashableCents: number;
  sweepsLockedCents: number;
  playthroughRemainingCents: number;
  lifetimeDepositsCents: number;
  version: number;
}

const COL: Record<string, keyof BalanceState> = {
  sweeps_cashable: 'sweepsCashableCents',
  sweeps_locked: 'sweepsLockedCents',
};

function makeTx(initial: Partial<BalanceState> = {}) {
  const state: BalanceState = {
    userId: 'u1',
    sweepsCashableCents: 0,
    sweepsLockedCents: 0,
    playthroughRemainingCents: 0,
    lifetimeDepositsCents: 0,
    version: 0,
    ...initial,
  };
  const ledger: any[] = [];
  const seenIdemKeys = new Set<string>();

  const tx: any = {
    state,
    ledger,
    insert(_table: any) {
      return {
        values: (v: any) => {
          const isLedger = 'kind' in v && 'balanceAfter' in v;
          const result: any = {
            onConflictDoNothing: async () => undefined,
          };
          result.then = (onFulfilled: any, onRejected: any) => {
            try {
              if (isLedger) {
                const key = `${v.userId}|${v.kind}|${v.idempotencyKey ?? ''}`;
                if (v.idempotencyKey && seenIdemKeys.has(key)) {
                  const err: any = new Error('duplicate');
                  err.code = '23505';
                  throw err;
                }
                if (v.idempotencyKey) seenIdemKeys.add(key);
                ledger.push(v);
              }
              return Promise.resolve(undefined).then(onFulfilled, onRejected);
            } catch (err) {
              return Promise.reject(err as Error).then(onFulfilled, onRejected);
            }
          };
          return result;
        },
      };
    },
    select() {
      return {
        from: () => ({
          where: () => ({
            for: () => ({
              limit: async () => [snapshot()],
            }),
            limit: async () => [snapshot()],
          }),
        }),
      };
    },
    update() {
      return {
        set: (_patch: any) => ({
          where: () => ({
            returning: async () => {
              const last = ledger.at(-1);
              if (last) {
                const col = COL[last.currency];
                (state as any)[col] = last.balanceAfter;
                state.version += 1;
              }
              return [snapshot()];
            },
          }),
        }),
      };
    },
  };

  function snapshot(): BalanceState {
    return { ...state };
  }

  return tx;
}

describe('LedgerService.post', () => {
  function makeService(): LedgerService {
    const db: any = {};
    return new LedgerService(db);
  }

  it('rejects zero or non-integer amounts', async () => {
    const svc = makeService();
    await expect(
      svc.post(
        {
          userId: 'u1',
          kind: 'deposit_purchase',
          currency: 'sweeps_locked',
          amount: 0,
        },
        makeTx(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      svc.post(
        {
          userId: 'u1',
          kind: 'deposit_purchase',
          currency: 'sweeps_locked',
          amount: 1.5,
        },
        makeTx(),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('credits a positive amount and writes a ledger row', async () => {
    const svc = makeService();
    const tx = makeTx();
    const out = await svc.post(
      {
        userId: 'u1',
        kind: 'deposit_purchase',
        currency: 'sweeps_locked',
        amount: 100_000,
        idempotencyKey: 'k1',
      },
      tx,
    );
    expect(out.balanceAfter).toBe(100_000);
    expect(out.snapshot.sweepsLockedCents).toBe(100_000);
    expect(tx.ledger).toHaveLength(1);
    expect(tx.ledger[0].balanceAfter).toBe(100_000);
    expect(tx.ledger[0].amount).toBe(100_000);
  });

  it('refuses to drive balance negative (insufficient funds)', async () => {
    const svc = makeService();
    const tx = makeTx({ sweepsCashableCents: 500 });
    await expect(
      svc.post(
        {
          userId: 'u1',
          kind: 'bet_stake',
          currency: 'sweeps_cashable',
          amount: -1000,
        },
        tx,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.ledger).toHaveLength(0);
    expect(tx.state.sweepsCashableCents).toBe(500);
  });

  it('debits when balance is sufficient', async () => {
    const svc = makeService();
    const tx = makeTx({ sweepsCashableCents: 1000 });
    const out = await svc.post(
      {
        userId: 'u1',
        kind: 'bet_stake',
        currency: 'sweeps_cashable',
        amount: -400,
      },
      tx,
    );
    expect(out.balanceAfter).toBe(600);
    expect(out.snapshot.sweepsCashableCents).toBe(600);
  });

  it('blocks duplicate idempotency key with ConflictException', async () => {
    const svc = makeService();
    const tx = makeTx();
    await svc.post(
      {
        userId: 'u1',
        kind: 'daily_bonus',
        currency: 'sweeps_cashable',
        amount: 30,
        idempotencyKey: 'k-dup',
      },
      tx,
    );
    await expect(
      svc.post(
        {
          userId: 'u1',
          kind: 'daily_bonus',
          currency: 'sweeps_cashable',
          amount: 30,
          idempotencyKey: 'k-dup',
        },
        tx,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('ledger balanceAfter equals running sum of amounts for currency', async () => {
    const svc = makeService();
    const tx = makeTx();
    await svc.post(
      {
        userId: 'u1',
        kind: 'deposit_purchase',
        currency: 'sweeps_locked',
        amount: 500,
        idempotencyKey: 'a',
      },
      tx,
    );
    await svc.post(
      {
        userId: 'u1',
        kind: 'deposit_first_purchase_bonus',
        currency: 'sweeps_locked',
        amount: 500,
        idempotencyKey: 'b',
      },
      tx,
    );
    expect(tx.ledger[0].balanceAfter).toBe(500);
    expect(tx.ledger[1].balanceAfter).toBe(1000);
    expect(tx.state.sweepsLockedCents).toBe(1000);
  });

  test('column mapping covers all wallet currencies', () => {
    expect(COL.sweeps_cashable).toBe('sweepsCashableCents');
    expect(COL.sweeps_locked).toBe('sweepsLockedCents');
  });
});
