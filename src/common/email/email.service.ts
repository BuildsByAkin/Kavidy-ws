import { Injectable, Logger } from '@nestjs/common';

export interface PasswordResetEmail {
  to: string;
  resetUrl: string;
  token: string;
  expiresAt: Date;
}

export abstract class EmailService {
  abstract sendPasswordReset(input: PasswordResetEmail): Promise<void>;
}

@Injectable()
export class NoopEmailService extends EmailService {
  private readonly logger = new Logger(NoopEmailService.name);

  sendPasswordReset(input: PasswordResetEmail): Promise<void> {
    this.logger.log(
      `[DEV] Password reset for ${input.to}: ${input.resetUrl} (token=${input.token}, exp=${input.expiresAt.toISOString()})`,
    );
    return Promise.resolve();
  }
}
