import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gt, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  MARKET_TERMINAL_STATUSES,
  markets,
  type MarketRow,
} from '../database/schema/markets';
import type { UpsertMarketSchema } from './dto/markets.dto';
import type { z } from 'zod';
import { BetsSettlementService } from '../bets/bets.settlement.service';
import { MarketsEventsService } from './markets-events.service';
import { toPublicMarket } from './markets.mapper';

export type UpsertMarketInput = z.infer<typeof UpsertMarketSchema>;

export interface ListMarketsParams {
  status?: string;
  creatorId?: string;
  limit: number;
  cursor?: string;
}

export interface MarketPage {
  items: MarketRow[];
  nextCursor: string | null;
}

interface CursorPayload {
  resolvesAt: Date;
  id: string;
}

const TERMINAL = MARKET_TERMINAL_STATUSES;

@Injectable()
export class MarketsService {
  private readonly logger = new Logger(MarketsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly eventsService: MarketsEventsService,
    private readonly betsSettlement: BetsSettlementService,
  ) {}

  async upsert(input: UpsertMarketInput): Promise<MarketRow> {
    const existing = await this.findById(input.id);

    if (existing && TERMINAL.has(existing.status as any)) {
      throw new ConflictException(
        `Market ${input.id} is in terminal status '${existing.status}' and cannot be updated`,
      );
    }

    const values = toDbValues(input);

    const [row] = await this.db
      .insert(markets)
      .values(values)
      .onConflictDoUpdate({
        target: markets.id,
        set: {
          creatorId: values.creatorId,
          creatorDisplayName: values.creatorDisplayName,
          creatorPrimaryPlatform: values.creatorPrimaryPlatform,
          question: values.question,
          kind: values.kind,
          status: values.status,
          confidenceLevel: values.confidenceLevel,
          opensAt: values.opensAt,
          resolvesAt: values.resolvesAt,
          generatedAt: values.generatedAt,
          resolvedAt: values.resolvedAt,
          evidence: values.evidence,
          updatedAt: new Date(),
        },
      })
      .returning();

    this.logger.log(`Market upserted: ${row.id} → status=${row.status}`);

    this.eventsService.emit({ type: 'market.changed', data: toPublicMarket(row) });

    if (TERMINAL.has(row.status as any)) {
      try {
        await this.betsSettlement.settlePicksForMarket(row.id, row.status);
      } catch (err) {
        this.logger.error(
          `Pick settlement failed for market ${row.id}: ${String(err)}`,
        );
      }
    }

    return row;
  }

  async upsertBulk(
    inputs: UpsertMarketInput[],
  ): Promise<{ upserted: number; skipped: number }> {
    const ids = inputs.map((i) => i.id);

    const existing = await this.db
      .select({ id: markets.id, status: markets.status })
      .from(markets)
      .where(inArray(markets.id, ids));

    const terminalIds = new Set(
      existing
        .filter((r) => TERMINAL.has(r.status as any))
        .map((r) => r.id),
    );

    const toProcess = inputs.filter((i) => !terminalIds.has(i.id));
    const skipped = inputs.length - toProcess.length;

    if (skipped > 0) {
      this.logger.warn(
        `Bulk upsert: skipping ${skipped} market(s) in terminal status`,
      );
    }

    if (toProcess.length === 0) {
      return { upserted: 0, skipped };
    }

    const rows = toProcess.map(toDbValues);

    const upserted = await this.db
      .insert(markets)
      .values(rows)
      .onConflictDoUpdate({
        target: markets.id,
        set: {
          creatorId: sql`excluded.creator_id`,
          creatorDisplayName: sql`excluded.creator_display_name`,
          creatorPrimaryPlatform: sql`excluded.creator_primary_platform`,
          question: sql`excluded.question`,
          kind: sql`excluded.kind`,
          status: sql`excluded.status`,
          confidenceLevel: sql`excluded.confidence_level`,
          opensAt: sql`excluded.opens_at`,
          resolvesAt: sql`excluded.resolves_at`,
          generatedAt: sql`excluded.generated_at`,
          resolvedAt: sql`excluded.resolved_at`,
          evidence: sql`excluded.evidence`,
          updatedAt: new Date(),
        },
      })
      .returning();

    for (const row of upserted) {
      this.eventsService.emit({ type: 'market.changed', data: toPublicMarket(row) });

      if (TERMINAL.has(row.status as any)) {
        try {
          await this.betsSettlement.settlePicksForMarket(row.id, row.status);
        } catch (err) {
          this.logger.error(
            `Pick settlement failed for market ${row.id} during bulk upsert: ${String(err)}`,
          );
        }
      }
    }

    this.logger.log(
      `Bulk upsert: processed ${toProcess.length} market(s), skipped ${skipped}`,
    );

    return { upserted: toProcess.length, skipped };
  }

  async list(params: ListMarketsParams): Promise<MarketPage> {
    const cursor = parseCursor(params.cursor);

    const conditions: SQL[] = [];

    if (params.status) {
      conditions.push(eq(markets.status, params.status as any));
    }
    if (params.creatorId) {
      conditions.push(eq(markets.creatorId, params.creatorId));
    }
    if (cursor) {
      conditions.push(
        or(
          gt(markets.resolvesAt, cursor.resolvesAt),
          and(
            eq(markets.resolvesAt, cursor.resolvesAt),
            gt(markets.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(markets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(markets.resolvesAt), asc(markets.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;
    const nextCursor =
      hasMore && sliced.length > 0
        ? buildCursor(sliced[sliced.length - 1])
        : null;

    return { items: sliced, nextCursor };
  }

  async findById(id: string): Promise<MarketRow | null> {
    const [row] = await this.db
      .select()
      .from(markets)
      .where(eq(markets.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByIdOrThrow(id: string): Promise<MarketRow> {
    const row = await this.findById(id);
    if (!row) throw new NotFoundException(`Market not found: ${id}`);
    return row;
  }
}

function toDbValues(input: UpsertMarketInput): typeof markets.$inferInsert {
  return {
    id: input.id,
    creatorId: input.creator_id,
    creatorDisplayName: input.creator_display_name,
    creatorPrimaryPlatform: input.creator_primary_platform,
    question: input.question,
    kind: input.kind,
    status: input.status,
    confidenceLevel: input.confidence_level,
    opensAt: new Date(input.opens_at),
    resolvesAt: new Date(input.resolves_at),
    generatedAt: new Date(input.generated_at),
    resolvedAt: input.resolved_at ? new Date(input.resolved_at) : null,
    evidence: (input.evidence ?? []).map((e) => ({
      platform: e.platform,
      summary: e.summary,
      source_url: e.source_url ?? null,
      observed_at: e.observed_at,
    })),
  };
}

function parseCursor(raw: string | undefined): CursorPayload | null {
  if (!raw) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
  const sep = decoded.indexOf('|');
  if (sep < 0) throw new BadRequestException('Invalid cursor');
  const iso = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  const resolvesAt = new Date(iso);
  if (Number.isNaN(resolvesAt.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { resolvesAt, id };
}

function buildCursor(row: MarketRow): string {
  const payload = `${row.resolvesAt.toISOString()}|${row.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}
