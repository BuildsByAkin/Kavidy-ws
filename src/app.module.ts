import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { KavidyThrottlerGuard } from './common/guards/throttler.guard';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { EmailModule } from './common/email/email.module';
import { ZodHttpExceptionFilter } from './common/filters/zod-http-exception.filter';
import { GeoModule } from './common/geo/geo.module';
import type { Env } from './config/env';
import { validateEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { IdeasModule } from './ideas/ideas.module';
import { SessionsModule } from './sessions/sessions.module';
import { StreamersModule } from './streamers/streamers.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          { name: 'short', ttl: 1_000, limit: 30 },
          {
            name: 'default',
            ttl: config.get('THROTTLE_TTL_MS', { infer: true }),
            limit: config.get('THROTTLE_LIMIT', { infer: true }),
          },
          { name: 'long', ttl: 3_600_000, limit: 1_000 },
        ],
      }),
    }),
    DatabaseModule,
    EmailModule,
    GeoModule,
    UsersModule,
    AuthModule,
    SessionsModule,
    WalletModule,
    StreamersModule,
    IdeasModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_GUARD, useClass: KavidyThrottlerGuard },
    { provide: APP_FILTER, useClass: ZodHttpExceptionFilter },
  ],
})
export class AppModule {}
