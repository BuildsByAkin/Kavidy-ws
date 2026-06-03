import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  NotFoundException,
  Param,
  Post,
  Query,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Public } from '../auth/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WorkerApiKeyGuard } from '../common/guards/worker-api-key.guard';
import {
  ListMarketsQueryDto,
  UpsertBulkMarketsDto,
  UpsertMarketDto,
} from './dto/markets.dto';
import { MarketsEventsService } from './markets-events.service';
import { toPublicMarket, type PublicMarket } from './markets.mapper';
import { MarketsService } from './markets.service';

@Controller({ path: 'markets', version: '1' })
export class MarketsController {
  constructor(
    private readonly markets: MarketsService,
    private readonly events: MarketsEventsService,
  ) {}

  @Post('upsert')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkerApiKeyGuard)
  async upsert(@Body() body: UpsertMarketDto): Promise<PublicMarket> {
    const row = await this.markets.upsert(body);
    return toPublicMarket(row);
  }

  @Post('upsert-bulk')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WorkerApiKeyGuard)
  async upsertBulk(
    @Body() body: UpsertBulkMarketsDto,
  ): Promise<{ upserted: number; skipped: number }> {
    return this.markets.upsertBulk(body.markets);
  }

  @Get()
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async list(
    @Query() query: ListMarketsQueryDto,
  ): Promise<{ items: PublicMarket[]; nextCursor: string | null }> {
    const page = await this.markets.list({
      status: query.status,
      creatorId: query.creator_id,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      items: page.items.map(toPublicMarket),
      nextCursor: page.nextCursor,
    };
  }

  @Sse('events')
  @Public()
  stream(): Observable<MessageEvent> {
    return this.events.events$.pipe(
      map((event): MessageEvent => ({ data: event })),
    );
  }

  @Get(':id')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async findOne(@Param('id') id: string): Promise<PublicMarket> {
    const row = await this.markets.findById(id);
    if (!row) throw new NotFoundException('Market not found');
    return toPublicMarket(row);
  }
}
