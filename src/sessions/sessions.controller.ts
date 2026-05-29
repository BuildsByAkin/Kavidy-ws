import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { TokensService } from '../auth/tokens.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { toSessionView, type SessionView } from './sessions.mapper';

@Controller({ path: 'sessions', version: '1' })
@UseGuards(JwtAuthGuard)
export class SessionsController {
  constructor(private readonly tokens: TokensService) {}

  @Get('me')
  async listMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ sessions: SessionView[] }> {
    const rows = await this.tokens.listSessionsForUser(user.id);
    return {
      sessions: rows.map((r) => toSessionView(r, user.sessionId)),
    };
  }

  @Delete('me/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    const ok = await this.tokens.revokeSessionById(id, user.id);
    if (!ok) throw new NotFoundException('Session not found');
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAllMine(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.tokens.revokeAllForUser(user.id, user.sessionId);
  }
}

@Controller({ path: 'admin/users', version: '1' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminSessionsController {
  constructor(private readonly tokens: TokensService) {}

  @Get(':userId/sessions')
  async listForUser(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
  ): Promise<{ sessions: SessionView[] }> {
    const rows = await this.tokens.listSessionsForUser(userId);
    return { sessions: rows.map((r) => toSessionView(r)) };
  }

  @Delete(':userId/sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeForUser(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
    @Param('sessionId', new ParseUUIDPipe({ version: '4' })) sessionId: string,
  ): Promise<void> {
    const ok = await this.tokens.revokeSessionById(sessionId, userId);
    if (!ok) throw new NotFoundException('Session not found');
  }

  @Delete(':userId/sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAllForUser(
    @Param('userId', new ParseUUIDPipe({ version: '4' })) userId: string,
  ): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }
}
