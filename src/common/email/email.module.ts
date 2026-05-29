import { Global, Module } from '@nestjs/common';
import { EmailService, NoopEmailService } from './email.service';

@Global()
@Module({
  providers: [{ provide: EmailService, useClass: NoopEmailService }],
  exports: [EmailService],
})
export class EmailModule {}
