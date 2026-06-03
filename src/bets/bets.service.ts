import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { and, desc, eq, inArray, lt, or } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { betEntries, type BetEntryRow } from '../database/schema/bet-entries';
import { betPicks, type BetPickRow } from '../database/schema/bet-picks';
import { markets } from '../database/schema/markets';
import { LedgerService } from '../wallet/ledger.service';
import {
  BET_CURRENCY,
  MIN_PICKS,
  MAX_PICKS,
  computePotentialPayout,
  getMultiplierX100,
} from './bets.constants';
import { MarketExposureService } from './market-exposure.service';

export interface PlaceEntryInput {
  picks: Array<{ marketId: string; direction: 'yes' | 'no' }>;
  stakeAmountCents: number;
  idempotencyKey: string;
}

export interface ListEntriesParams {
  userId: string;
  status?: 'pending' | 'won' | 'lost' | 'void';
  limit: number;
  cursor?: string;
}

export interface EntryPage {
  items: Array<{ entry: BetEntryRow; picks: BetPickRow[] }>;
  nextCursor: string | null;
}

@Injectable()
export class BetsService {
  private readonly logger = new Logger(BetsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ledger: LedgerService,
    private readonly exposure: MarketExposureService,
  ) {}

  async placeEntry(
    userId: string,
    input: PlaceEntryInput,
  ): Promise<{ entry: BetEntryRow; picks: BetPickRow[] }> {
    const uniqueMarketIds = new Set(input.picks.map((p) => p.marketId));
    if (uniqueMarketIds.size !== input.picks.length) {
      throw new BadRequestException(
        'Duplicate market IDs are not allowed in the same entry',
      );
    }

    if (input.picks.length < MIN_PICKS || input.picks.length > MAX_PICKS) {
      throw new UnprocessableEntityException(
        `Entry must have between ${MIN_PICKS} and ${MAX_PICKS} picks`,
      );
    }

    const existing = await this.findEntryByIdemKey(userId, input.idempotencyKey);
    if (existing) {
      const picks = await this.loadPicksForEntry(existing.id);
      return { entry: existing, picks };
    }

    const marketRows = await this.db
      .select()
      .from(markets)
      .where(inArray(markets.id, [...uniqueMarketIds]));

    if (marketRows.length !== uniqueMarketIds.size) {
      const foundIds = new Set(marketRows.map((m) => m.id));
      const missing = [...uniqueMarketIds].find((id) => !foundIds.has(id));
      throw new NotFoundException(`Market not found: ${missing}`);
    }

    const nonOpen = marketRows.find((m) => m.status !== 'open');
    if (nonOpen) {
      throw new ConflictException(
        `Market '${nonOpen.id}' is not open for betting (status: ${nonOpen.status})`,
      );
    }

    const marketMap = new Map(marketRows.map((m) => [m.id, m]));

    const multiplierX100 = getMultiplierX100(input.picks.length);
    const potentialPayoutCents = computePotentialPayout(
      input.stakeAmountCents,
      multiplierX100,
    );

    const entryId = randomUUID();
    const now = new Date();

    let createdEntry: BetEntryRow;
    let createdPicks: BetPickRow[];

    try {
      const result = await this.db.transaction(async (tx) => {
        const [entry] = await tx
          .insert(betEntries)
          .values({
            id: entryId,
            userId,
            status: 'pending',
            currency: BET_CURRENCY,
            pickCount: input.picks.length,
            stakeAmountCents: input.stakeAmountCents,
            payoutMultiplierX100: multiplierX100,
            potentialPayoutCents,
            idempotencyKey: input.idempotencyKey,
          })
          .returning();

        const pickValues = input.picks.map((p) => ({
          id: randomUUID(),
          entryId: entry.id,
          marketId: p.marketId,
          direction: p.direction,
          status: 'pending' as const,
          marketQuestion: marketMap.get(p.marketId)!.question,
        }));

        const picks = await tx.insert(betPicks).values(pickValues).returning();

        await this.ledger.post(
          {
            userId,
            kind: 'bet_stake',
            currency: BET_CURRENCY,
            amount: -input.stakeAmountCents,
            referenceType: 'bet_entry',
            referenceId: entry.id,
            idempotencyKey: `bet_stake:${entry.id}`,
            memo: `Entry placed — ${input.picks.length} picks`,
            metadata: {
              pick_count: input.picks.length,
              multiplier_x100: multiplierX100,
              potential_payout_cents: potentialPayoutCents,
            },
          },
          tx,
        );

        return { entry, picks };
      });

      createdEntry = result.entry;
      createdPicks = result.picks;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const replay = await this.findEntryByIdemKey(userId, input.idempotencyKey);
        if (replay) {
          const picks = await this.loadPicksForEntry(replay.id);
          return { entry: replay, picks };
        }
      }
      throw err;
    }

    this.logger.log(
      `Entry placed: ${createdEntry.id} user=${userId} picks=${input.picks.length} stake=${input.stakeAmountCents}`,
    );

    for (const pick of input.picks) {
      this.exposure.checkAndCloseIfNeeded(pick.marketId).catch((err) => {
        this.logger.error(
          `Exposure check failed for market ${pick.marketId}: ${String(err)}`,
        );
      });
    }

    return { entry: createdEntry, picks: createdPicks };
  }

  async listEntries(params: ListEntriesParams): Promise<EntryPage> {
    const cursor = parseCursor(params.cursor);

    const conditions = [eq(betEntries.userId, params.userId)];

    if (params.status) {
      conditions.push(eq(betEntries.status, params.status));
    }

    if (cursor) {
      conditions.push(
        or(
          lt(betEntries.createdAt, cursor.createdAt),
          and(
            eq(betEntries.createdAt, cursor.createdAt),
            lt(betEntries.id, cursor.id),
          ),
        )!,
      );
    }

    const rows = await this.db
      .select()
      .from(betEntries)
      .where(and(...conditions))
      .orderBy(desc(betEntries.createdAt), desc(betEntries.id))
      .limit(params.limit + 1);

    const hasMore = rows.length > params.limit;
    const sliced = hasMore ? rows.slice(0, params.limit) : rows;

    const entryIds = sliced.map((e) => e.id);
    const allPicks =
      entryIds.length > 0
        ? await this.db
            .select()
            .from(betPicks)
            .where(inArray(betPicks.entryId, entryIds))
        : [];

    const picksByEntry = new Map<string, BetPickRow[]>();
    for (const pick of allPicks) {
      const list = picksByEntry.get(pick.entryId) ?? [];
      list.push(pick);
      picksByEntry.set(pick.entryId, list);
    }

    const items = sliced.map((entry) => ({
      entry,
      picks: picksByEntry.get(entry.id) ?? [],
    }));

    const nextCursor =
      hasMore && sliced.length > 0
        ? buildCursor(sliced[sliced.length - 1])
        : null;

    return { items, nextCursor };
  }

  async findEntryById(
    entryId: string,
    userId: string,
  ): Promise<{ entry: BetEntryRow; picks: BetPickRow[] } | null> {
    const [entry] = await this.db
      .select()
      .from(betEntries)
      .where(and(eq(betEntries.id, entryId), eq(betEntries.userId, userId)))
      .limit(1);

    if (!entry) return null;

    const picks = await this.loadPicksForEntry(entry.id);
    return { entry, picks };
  }

  private async findEntryByIdemKey(
    userId: string,
    idempotencyKey: string,
  ): Promise<BetEntryRow | null> {
    const [row] = await this.db
      .select()
      .from(betEntries)
      .where(
        and(
          eq(betEntries.userId, userId),
          eq(betEntries.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async loadPicksForEntry(entryId: string): Promise<BetPickRow[]> {
    return this.db
      .select()
      .from(betPicks)
      .where(eq(betPicks.entryId, entryId));
  }
}

function parseCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
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
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || !id) {
    throw new BadRequestException('Invalid cursor');
  }
  return { createdAt, id };
}

function buildCursor(row: BetEntryRow): string {
  const payload = `${row.createdAt.toISOString()}|${row.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
