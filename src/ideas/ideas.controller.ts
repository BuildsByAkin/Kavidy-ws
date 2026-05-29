import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { CreatePostDto, ListPostsQueryDto } from './dto/ideas.dto';
import { IdeasService, type FeedPage, type LikeResult } from './ideas.service';
import { type PublicPost } from './ideas.mapper';

@Controller({ path: 'ideas', version: '1' })
@UseGuards(JwtAuthGuard)
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPostsQueryDto,
  ): Promise<FeedPage> {
    return this.ideas.listFeed({
      viewerId: user.id,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreatePostDto,
  ): Promise<PublicPost> {
    return this.ideas.createPost({
      userId: user.id,
      body: body.body,
      streamerId: body.streamerId,
    });
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async like(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<LikeResult> {
    return this.ideas.like(id, user.id);
  }

  @Delete(':id/like')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async unlike(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<LikeResult> {
    return this.ideas.unlike(id, user.id);
  }
}
