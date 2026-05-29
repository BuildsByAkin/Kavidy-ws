import { createHash, randomUUID } from 'crypto';
import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { idempotencyKeys } from '../database/schema/idempotency-keys';
import type { Tx } from './wallet.types';

export interface IdempotencyOptions<T> {
  scope: string;
  key: string;
  userId: string | null;
  requestPayload?: unknown;
  handler: (tx: Tx) => Promise<T>;
}

export interface IdempotencyResult<T> {
  result: T;
  replayed: boolean;
}

@Injectable()
export class IdempotencyService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async execute<T>(opts: IdempotencyOptions<T>): Promise<IdempotencyResult<T>> {
    const requestHash = opts.requestPayload
      ? hash(JSON.stringify(opts.requestPayload))
      : null;

    const existing = await this.db
      .select()
      .from(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.scope, opts.scope),
          opts.userId === null
            ? sql`${idempotencyKeys.userId} IS NULL`
            : eq(idempotencyKeys.userId, opts.userId),
          eq(idempotencyKeys.key, opts.key),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      if (requestHash && row.requestHash && row.requestHash !== requestHash) {
        throw new ConflictException(
          'Idempotency key reused with a different request payload',
        );
      }
      if (row.completedAt && row.response !== null) {
        return { result: row.response as T, replayed: true };
      }
      throw new ConflictException(
        'Request with this idempotency key is in progress',
      );
    }

    const id = randomUUID();
    try {
      await this.db.insert(idempotencyKeys).values({
        id,
        userId: opts.userId,
        scope: opts.scope,
        key: opts.key,
        requestHash,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        const replay = await this.execute(opts);
        return replay;
      }
      throw err;
    }

    const result = await this.db.transaction(async (tx) => opts.handler(tx));

    await this.db
      .update(idempotencyKeys)
      .set({
        completedAt: new Date(),
        statusCode: 200,
        response: result,
      })
      .where(eq(idempotencyKeys.id, id));

    return { result, replayed: false };
  }
}

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
