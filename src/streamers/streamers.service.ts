import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { streamers, type StreamerRow } from '../database/schema/streamers';

export interface SearchStreamersParams {
  q?: string;
  limit: number;
}

@Injectable()
export class StreamersService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async search(params: SearchStreamersParams): Promise<StreamerRow[]> {
    const conditions = [eq(streamers.active, true)];
    if (params.q && params.q.length > 0) {
      const needle = `%${params.q.toLowerCase()}%`;
      conditions.push(
        or(
          sql`lower(${streamers.handle}) like ${needle}`,
          sql`lower(${streamers.displayName}) like ${needle}`,
        )!,
      );
    }

    return this.db
      .select()
      .from(streamers)
      .where(and(...conditions))
      .orderBy(asc(streamers.displayName))
      .limit(params.limit);
  }

  async findById(id: number): Promise<StreamerRow | null> {
    const [row] = await this.db
      .select()
      .from(streamers)
      .where(eq(streamers.id, id))
      .limit(1);
    return row ?? null;
  }

  async findManyByIds(ids: number[]): Promise<StreamerRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(streamers).where(inArray(streamers.id, ids));
  }
}
