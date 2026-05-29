import { Logger, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
  app.use(cookieParser());
  app.set('trust proxy', 1);
  app.enableShutdownHooks();

  app.useBodyParser('json', { limit: '100kb' });
  app.useBodyParser('urlencoded', { limit: '100kb', extended: true });

  const server = app.getHttpServer();
  server.headersTimeout = 65_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 60_000;
  server.maxHeadersCount = 100;

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  const origins = config.get('CORS_ORIGINS', { infer: true });
  const allowAll = origins.includes('*');
  app.enableCors({
    origin: allowAll ? true : origins.length > 0 ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  logger.log(`Kavidy backend listening on port ${port}`);
}

void bootstrap();
