import { Controller, Get, Header, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  ExportTransactionsQueryDto,
  ListTransactionsQueryDto,
} from './dto/wallet.dto';
import { TransactionsService } from './transactions.service';
import type { TransactionPage } from './transactions.types';

@Controller({ path: 'wallet/transactions', version: '1' })
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<TransactionPage> {
    return this.transactions.list({
      userId: user.id,
      filter: query.filter,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ExportTransactionsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.transactions.exportCsv({
      userId: user.id,
      filter: query.filter,
    });
    const filename = `kavidy-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }
}
