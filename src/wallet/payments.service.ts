import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

export interface PaymentSessionInput {
  depositIntentId: string;
  userId: string;
  amountCents: number;
  packageCode: string;
  packageName: string;
  metadata: Record<string, string>;
}

export interface PaymentSessionResult {
  sessionId: string;
  checkoutUrl: string;
}

export type PaymentEventType =
  | 'session.completed'
  | 'session.expired'
  | 'session.failed';

export interface PaymentEvent {
  id: string;
  type: PaymentEventType;
  sessionId: string;
  depositIntentId: string;
  amountCents: number;
  paymentRef: string | null;
}

@Injectable()
export class PaymentsService {
  createCheckoutSession(input: PaymentSessionInput): PaymentSessionResult {
    const sessionId = `mock_sess_${randomUUID().replace(/-/g, '')}`;
    const url = new URL('https://payments.local/mock-checkout');
    url.searchParams.set('session_id', sessionId);
    url.searchParams.set('deposit_intent_id', input.depositIntentId);
    url.searchParams.set('amount', String(input.amountCents));
    url.searchParams.set('package', input.packageCode);
    return { sessionId, checkoutUrl: url.toString() };
  }

  buildCompletedEvent(args: {
    depositIntentId: string;
    sessionId: string;
    amountCents: number;
    paymentRef?: string | null;
  }): PaymentEvent {
    return {
      id: `mock_evt_${randomUUID().replace(/-/g, '')}`,
      type: 'session.completed',
      sessionId: args.sessionId,
      depositIntentId: args.depositIntentId,
      amountCents: args.amountCents,
      paymentRef:
        args.paymentRef ?? `mock_pi_${randomUUID().replace(/-/g, '')}`,
    };
  }

  buildFailureEvent(args: {
    depositIntentId: string;
    sessionId: string;
    amountCents: number;
    type: Extract<PaymentEventType, 'session.expired' | 'session.failed'>;
  }): PaymentEvent {
    return {
      id: `mock_evt_${randomUUID().replace(/-/g, '')}`,
      type: args.type,
      sessionId: args.sessionId,
      depositIntentId: args.depositIntentId,
      amountCents: args.amountCents,
      paymentRef: null,
    };
  }
}
