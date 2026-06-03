import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { WorkerApiKeyGuard } from '../common/guards/worker-api-key.guard';
import { UsersService } from '../users/users.service';
import { WalletService } from '../wallet/wallet.service';
import { IdempotencyKey } from '../wallet/idempotency.decorator';
import { BetsService } from './bets.service';
import { BetsSettlementService } from './bets.settlement.service';
import { ListEntriesQueryDto, PlaceEntryDto } from './dto/bets.dto';
import { toPublicEntry, type EntryPage, type PublicEntry } from './bets.mapper';
import {
  PAYOUT_MULTIPLIERS,
  MIN_PICKS,
  MAX_PICKS,
  MIN_STAKE_CENTS,
  MAX_STAKE_CENTS,
} from './bets.constants';

@Controller({ path: 'bets', version: '1' })
@UseGuards(JwtAuthGuard)
export class BetsController {
  constructor(
    private readonly bets: BetsService,
    private readonly settlement: BetsSettlementService,
    private readonly users: UsersService,
    private readonly wallet: WalletService,
  ) {}

  @Post('entries')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async placeEntry(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() body: PlaceEntryDto,
    @IdempotencyKey() idemKey: string,
  ): Promise<PublicEntry> {
    const user = await this.users.findById(auth.id);
    if (!user) throw new NotFoundException('User not found');
    this.wallet.assertMoneyActionAllowed(user);

    const { entry, picks } = await this.bets.placeEntry(auth.id, {
      picks: body.picks,
      stakeAmountCents: body.stakeAmountCents,
      idempotencyKey: idemKey,
    });

    return toPublicEntry(entry, picks);
  }

  @Get('entries')
  async listEntries(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ListEntriesQueryDto,
  ): Promise<EntryPage> {
    const page = await this.bets.listEntries({
      userId: auth.id,
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });

    return {
      items: page.items.map(({ entry, picks }) => toPublicEntry(entry, picks)),
      nextCursor: page.nextCursor,
    };
  }

  @Get('entries/:id')
  async getEntry(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PublicEntry> {
    const result = await this.bets.findEntryById(id, auth.id);
    if (!result) throw new NotFoundException('Entry not found');
    return toPublicEntry(result.entry, result.picks);
  }

  @Get('multipliers')
  getMultipliers(): {
    table: Record<string, number>;
    minPicks: number;
    maxPicks: number;
    minStakeCents: number;
    maxStakeCents: number;
  } {
    return {
      table: Object.fromEntries(
        Object.entries(PAYOUT_MULTIPLIERS).map(([k, v]) => [k, v]),
      ),
      minPicks: MIN_PICKS,
      maxPicks: MAX_PICKS,
      minStakeCents: MIN_STAKE_CENTS,
      maxStakeCents: MAX_STAKE_CENTS,
    };
  }

  @Post('admin/settle-market/:marketId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkerApiKeyGuard)
  async settleMarket(
    @Param('marketId') marketId: string,
    @Body() body: { marketFinalStatus: string },
  ): Promise<{ settled: boolean }> {
    await this.settlement.settlePicksForMarket(
      marketId,
      body.marketFinalStatus,
    );
    return { settled: true };
  }
}
