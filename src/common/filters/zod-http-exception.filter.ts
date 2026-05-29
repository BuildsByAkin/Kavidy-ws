import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

@Catch()
export class ZodHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ZodHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as {
        issues?: Array<{
          path: (string | number)[];
          message: string;
          code: string;
        }>;
      };
      const body: ErrorBody = {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'ValidationError',
        message: 'Request validation failed',
        details: (zodError.issues ?? []).map((i) => ({
          path: i.path,
          message: i.message,
          code: i.code,
        })),
      };
      res.status(body.statusCode).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const body: ErrorBody =
        typeof response === 'string'
          ? {
              statusCode: status,
              error: exception.name.replace(/Exception$/, ''),
              message: response,
            }
          : {
              statusCode: status,
              error:
                (response as { error?: string }).error ??
                exception.name.replace(/Exception$/, ''),
              message:
                (response as { message?: string }).message ?? exception.message,
            };
      res.status(status).json(body);
      return;
    }

    this.logger.error(
      'Unhandled exception',
      exception instanceof Error ? exception.stack : String(exception),
    );

    const body: ErrorBody = {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    };
    res.status(body.statusCode).json(body);
  }
}
