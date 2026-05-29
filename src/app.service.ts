import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  serviceName(): string {
    return 'kavidy-backend';
  }
}
