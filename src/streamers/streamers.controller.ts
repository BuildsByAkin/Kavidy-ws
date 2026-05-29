import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SearchStreamersQueryDto } from './dto/streamers.dto';
import { toPublicStreamer, type PublicStreamer } from './streamers.mapper';
import { StreamersService } from './streamers.service';

@Controller({ path: 'streamers', version: '1' })
@UseGuards(JwtAuthGuard)
export class StreamersController {
  constructor(private readonly streamers: StreamersService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async search(
    @Query() query: SearchStreamersQueryDto,
  ): Promise<{ items: PublicStreamer[] }> {
    const rows = await this.streamers.search({
      q: query.q,
      limit: query.limit,
    });
    return { items: rows.map(toPublicStreamer) };
  }
}
