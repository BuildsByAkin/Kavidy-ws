import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, desc, eq } from 'drizzle-orm';
import type { Env } from '../config/env';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  depositIntents,
  type DepositIntentRow,
} from '../database/schema/deposit-intents';
import type { UserRow } from '../database/schema/users';
import { FIRST_PURCHASE_BONUS_MULTIPLIER } from './constants';
import { CoinPackagesService } from './coin-packages.service';
import { LedgerService } from './ledger.service';
import { PaymentsService, type PaymentEvent } from './payments.service';

export interface CreateCheckoutResult {
  depositIntentId: string;
  providerSessionId: string;
  checkoutUrl: string;
  priceCents: number;
  baseSweepsCents: number;
  bonusSweepsCents: number;
  firstPurchaseApplied: boolean;
}

export interface FirstPurchaseOffer {
  available: boolean;
  multiplier: number;
}

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);
  private readonly successUrl: string;
  private readonly cancelUrl: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    config: ConfigService<Env, true>,
    private readonly packages: CoinPackagesService,
    private readonly payments: PaymentsService,
    private readonly ledger: LedgerService,
  ) {
    this.successUrl = config.get('PAYMENT_SUCCESS_URL', { infer: true });
    this.cancelUrl = config.get('PAYMENT_CANCEL_URL', { infer: true });
  }

  async getFirstPurchaseOffer(userId: string): Promise<FirstPurchaseOffer> {
    const [row] = await this.db
      .select({ value: count() })
      .from(depositIntents)
      .where(
        and(
          eq(depositIntents.userId, userId),
          eq(depositIntents.status, 'completed'),
        ),
      );
    const completed = row?.value ?? 0;
    return {
      available: completed === 0,
      multiplier: FIRST_PURCHASE_BONUS_MULTIPLIER,
    };
  }

  async createCheckout(
    user: UserRow,
    input: { packageId: number },
    idempotencyKey: string,
  ): Promise<CreateCheckoutResult> {
    const pkg = await this.packages.getActiveByIdOrThrow(input.packageId);

    const existing = await this.findIntentByIdemKey(user.id, idempotencyKey);
    if (existing) {
      if (existing.packageId !== pkg.id) {
        throw new ConflictException(
          'Idempotency key reused with a different package',
        );
      }
      return this.toCheckoutResult(existing);
    }

    const offer = await this.getFirstPurchaseOffer(user.id);
    const baseSweepsCents = pkg.sweepsCents;
    const bonusSweepsCents = offer.available
      ? baseSweepsCents * (FIRST_PURCHASE_BONUS_MULTIPLIER - 1)
      : 0;

    const intentId = randomUUID();

    let inserted: DepositIntentRow;
    try {
      const [row] = await this.db
        .insert(depositIntents)
        .values({
          id: intentId,
          userId: user.id,
          packageId: pkg.id,
          status: 'pending',
          priceCents: pkg.priceCents,
          baseSweepsCents,
          bonusSweepsCents,
          firstPurchaseApplied: offer.available,
          idempotencyKey,
          metadata: {
            successUrl: this.successUrl,
            cancelUrl: this.cancelUrl,
          },
        })
        .returning();
      inserted = row;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const replay = await this.findIntentByIdemKey(user.id, idempotencyKey);
        if (replay) return this.toCheckoutResult(replay);
      }
      throw err;
    }

    const session = this.payments.createCheckoutSession({
      userId: user.id,
      amountCents: pkg.priceCents,
      packageCode: pkg.code,
      packageName: pkg.name,
      depositIntentId: inserted.id,
      metadata: {
        user_id: user.id,
        deposit_intent_id: inserted.id,
        package_id: String(pkg.id),
        package_code: pkg.code,
        base_sweeps_cents: String(baseSweepsCents),
        bonus_sweeps_cents: String(bonusSweepsCents),
        first_purchase_applied: offer.available ? 'true' : 'false',
      },
    });

    const [updated] = await this.db
      .update(depositIntents)
      .set({
        providerSessionId: session.sessionId,
        updatedAt: new Date(),
      })
      .where(eq(depositIntents.id, inserted.id))
      .returning();

    return {
      depositIntentId: updated.id,
      providerSessionId: session.sessionId,
      checkoutUrl: session.checkoutUrl,
      priceCents: updated.priceCents,
      baseSweepsCents: updated.baseSweepsCents,
      bonusSweepsCents: updated.bonusSweepsCents,
      firstPurchaseApplied: updated.firstPurchaseApplied,
    };
  }

  async simulatePayment(
    user: UserRow,
    depositIntentId: string,
    outcome: 'completed' | 'failed' | 'expired',
  ): Promise<DepositIntentRow> {
    const [intent] = await this.db
      .select()
      .from(depositIntents)
      .where(eq(depositIntents.id, depositIntentId))
      .limit(1);
    if (!intent || intent.userId !== user.id) {
      throw new NotFoundException('Deposit intent not found');
    }
    if (!intent.providerSessionId) {
      throw new BadRequestException(
        'Deposit intent has no provider session attached',
      );
    }

    const event =
      outcome === 'completed'
        ? this.payments.buildCompletedEvent({
            depositIntentId: intent.id,
            sessionId: intent.providerSessionId,
            amountCents: intent.priceCents,
          })
        : this.payments.buildFailureEvent({
            depositIntentId: intent.id,
            sessionId: intent.providerSessionId,
            amountCents: intent.priceCents,
            type: outcome === 'expired' ? 'session.expired' : 'session.failed',
          });

    await this.handleProviderEvent(event);

    const [refreshed] = await this.db
      .select()
      .from(depositIntents)
      .where(eq(depositIntents.id, intent.id))
      .limit(1);
    return refreshed;
  }

  async handleProviderEvent(event: PaymentEvent): Promise<void> {
    if (event.type === 'session.completed') {
      await this.handleCompletedEvent(event);
      return;
    }
    await this.handleFailureEvent(event);
  }

  private async handleCompletedEvent(event: PaymentEvent): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [intent] = await tx
        .select()
        .from(depositIntents)
        .where(eq(depositIntents.id, event.depositIntentId))
        .for('update')
        .limit(1);

      if (!intent) {
        this.logger.error(
          `Deposit intent ${event.depositIntentId} not found for event ${event.id}`,
        );
        return;
      }

      if (intent.status === 'completed') {
        if (intent.providerEventId === event.id) {
          this.logger.log(`Replay of provider event ${event.id} (no-op)`);
          return;
        }
        this.logger.warn(
          `Intent ${intent.id} already completed; ignoring duplicate event ${event.id}`,
        );
        return;
      }

      if (intent.priceCents !== event.amountCents) {
        this.logger.error(
          `Amount mismatch on intent ${intent.id}: expected ${intent.priceCents}, got ${event.amountCents}`,
        );
        await tx
          .update(depositIntents)
          .set({
            status: 'failed',
            failedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(depositIntents.id, intent.id));
        return;
      }

      const refType = 'deposit_intent';
      const refId = intent.id;
      const baseIdem = `deposit:${intent.id}`;

      if (intent.baseSweepsCents > 0) {
        await this.ledger.post(
          {
            userId: intent.userId,
            kind: 'deposit_purchase',
            currency: 'sweeps_locked',
            amount: intent.baseSweepsCents,
            referenceType: refType,
            referenceId: refId,
            idempotencyKey: `${baseIdem}:sweeps`,
            memo: 'Coin package purchase',
          },
          tx,
        );
      }

      if (intent.firstPurchaseApplied && intent.bonusSweepsCents > 0) {
        await this.ledger.post(
          {
            userId: intent.userId,
            kind: 'deposit_first_purchase_bonus',
            currency: 'sweeps_locked',
            amount: intent.bonusSweepsCents,
            referenceType: refType,
            referenceId: refId,
            idempotencyKey: `${baseIdem}:first_purchase`,
            memo: 'First-purchase 2x bonus',
          },
          tx,
        );
      }

      await tx
        .update(depositIntents)
        .set({
          status: 'completed',
          providerPaymentRef: event.paymentRef,
          providerEventId: event.id,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(depositIntents.id, intent.id));
    });
  }

  private async handleFailureEvent(event: PaymentEvent): Promise<void> {
    const status = event.type === 'session.expired' ? 'expired' : 'failed';
    await this.db
      .update(depositIntents)
      .set({
        status,
        failedAt: new Date(),
        providerEventId: event.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(depositIntents.id, event.depositIntentId),
          eq(depositIntents.status, 'pending'),
        ),
      );
  }

  async listRecent(userId: string, limit = 20): Promise<DepositIntentRow[]> {
    return this.db
      .select()
      .from(depositIntents)
      .where(eq(depositIntents.userId, userId))
      .orderBy(desc(depositIntents.createdAt))
      .limit(limit);
  }

  private async findIntentByIdemKey(
    userId: string,
    key: string,
  ): Promise<DepositIntentRow | null> {
    const [row] = await this.db
      .select()
      .from(depositIntents)
      .where(
        and(
          eq(depositIntents.userId, userId),
          eq(depositIntents.idempotencyKey, key),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private toCheckoutResult(row: DepositIntentRow): CreateCheckoutResult {
    if (!row.providerSessionId) {
      throw new BadRequestException(
        'Existing deposit intent is missing a payment session — retry with a new idempotency key',
      );
    }
    return {
      depositIntentId: row.id,
      providerSessionId: row.providerSessionId,
      checkoutUrl: '',
      priceCents: row.priceCents,
      baseSweepsCents: row.baseSweepsCents,
      bonusSweepsCents: row.bonusSweepsCents,
      firstPurchaseApplied: row.firstPurchaseApplied,
    };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
