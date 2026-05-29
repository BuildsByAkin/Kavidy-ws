import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  coinPackages,
  type CoinPackageRow,
} from '../database/schema/coin-packages';
import { DEFAULT_COIN_PACKAGES } from './constants';

export interface PublicCoinPackage {
  id: number;
  code: string;
  name: string;
  description: string | null;
  priceCents: number;
  sweepsCents: number;
  bonusPercent: number;
  badge: string | null;
  sortOrder: number;
}

@Injectable()
export class CoinPackagesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CoinPackagesService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedDefaults();
  }

  async seedDefaults(): Promise<void> {
    for (const pkg of DEFAULT_COIN_PACKAGES) {
      await this.db
        .insert(coinPackages)
        .values({
          code: pkg.code,
          name: pkg.name,
          description: pkg.description,
          priceCents: pkg.priceCents,
          sweepsCents: pkg.sweepsCents,
          bonusPercent: pkg.bonusPercent,
          badge: pkg.badge,
          sortOrder: pkg.sortOrder,
        })
        .onConflictDoNothing({ target: coinPackages.code });
    }
    this.logger.log('Coin packages seed verified');
  }

  async listActive(): Promise<CoinPackageRow[]> {
    return this.db
      .select()
      .from(coinPackages)
      .where(eq(coinPackages.active, true))
      .orderBy(asc(coinPackages.sortOrder));
  }

  async findById(id: number): Promise<CoinPackageRow | null> {
    const [row] = await this.db
      .select()
      .from(coinPackages)
      .where(eq(coinPackages.id, id))
      .limit(1);
    return row ?? null;
  }

  async findByCode(code: string): Promise<CoinPackageRow | null> {
    const [row] = await this.db
      .select()
      .from(coinPackages)
      .where(eq(coinPackages.code, code))
      .limit(1);
    return row ?? null;
  }

  async getActiveByIdOrThrow(id: number): Promise<CoinPackageRow> {
    const row = await this.findById(id);
    if (!row || !row.active) {
      throw new NotFoundException('Coin package not found');
    }
    return row;
  }
}

export function toPublicCoinPackage(row: CoinPackageRow): PublicCoinPackage {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceCents: row.priceCents,
    sweepsCents: row.sweepsCents,
    bonusPercent: row.bonusPercent,
    badge: row.badge,
    sortOrder: row.sortOrder,
  };
}
