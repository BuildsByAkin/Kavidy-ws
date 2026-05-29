import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get('health')
  @SkipThrottle()
  health(): { status: 'ok'; service: string } {
    return { status: 'ok', service: this.appService.serviceName() };
  }
}
