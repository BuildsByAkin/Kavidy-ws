import {
  Global,
  Inject,
  Logger,
  Module,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Env } from '../config/env';
import * as schema from './schema';

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_CLIENT = Symbol('PG_CLIENT');

export type Database = ReturnType<typeof drizzle<typeof schema>>;
export type DbTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];
export type DbExecutor = Database | DbTransaction;

@Global()
@Module({
  providers: [
    {
      provide: PG_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const url = config.get('DATABASE_URL', { infer: true });
        return postgres(url, {
          max: 10,
          idle_timeout: 30,
          connect_timeout: 10,
        });
      },
    },
    {
      provide: DRIZZLE,
      inject: [PG_CLIENT],
      useFactory: (client: postgres.Sql) =>
        drizzle(client, { schema, casing: 'snake_case' }),
    },
  ],
  exports: [DRIZZLE, PG_CLIENT],
})
export class DatabaseModule implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG_CLIENT) private readonly client: postgres.Sql) {}

  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing Postgres connections');
    await this.client.end({ timeout: 5 });
  }
}
