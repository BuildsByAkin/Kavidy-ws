import { PaymentsService } from './payments.service';

describe('PaymentsService (placeholder)', () => {
  const svc = new PaymentsService();

  it('creates a unique mock session id and checkout url', () => {
    const a = svc.createCheckoutSession({
      depositIntentId: 'intent-1',
      userId: 'user-1',
      amountCents: 999,
      packageCode: 'rookie',
      packageName: 'Rookie',
      metadata: { user_id: 'user-1' },
    });
    const b = svc.createCheckoutSession({
      depositIntentId: 'intent-2',
      userId: 'user-1',
      amountCents: 999,
      packageCode: 'rookie',
      packageName: 'Rookie',
      metadata: { user_id: 'user-1' },
    });
    expect(a.sessionId).toMatch(/^mock_sess_/);
    expect(b.sessionId).toMatch(/^mock_sess_/);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(a.checkoutUrl).toContain(a.sessionId);
    expect(a.checkoutUrl).toContain('intent-1');
    expect(a.checkoutUrl).toContain('999');
  });

  it('builds a completed event with payment ref', () => {
    const e = svc.buildCompletedEvent({
      depositIntentId: 'i1',
      sessionId: 'sess',
      amountCents: 999,
    });
    expect(e.type).toBe('session.completed');
    expect(e.depositIntentId).toBe('i1');
    expect(e.sessionId).toBe('sess');
    expect(e.amountCents).toBe(999);
    expect(e.paymentRef).toMatch(/^mock_pi_/);
    expect(e.id).toMatch(/^mock_evt_/);
  });

  it('builds failure events without payment ref', () => {
    const expired = svc.buildFailureEvent({
      depositIntentId: 'i1',
      sessionId: 'sess',
      amountCents: 999,
      type: 'session.expired',
    });
    expect(expired.type).toBe('session.expired');
    expect(expired.paymentRef).toBeNull();
    const failed = svc.buildFailureEvent({
      depositIntentId: 'i1',
      sessionId: 'sess',
      amountCents: 999,
      type: 'session.failed',
    });
    expect(failed.type).toBe('session.failed');
  });
});
