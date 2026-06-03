import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { PublicMarket } from './markets.mapper';

export interface MarketChangedEvent {
  type: 'market.changed';
  data: PublicMarket;
}

@Injectable()
export class MarketsEventsService {
  private readonly subject = new Subject<MarketChangedEvent>();

  emit(event: MarketChangedEvent): void {
    this.subject.next(event);
  }

  get events$(): Observable<MarketChangedEvent> {
    return this.subject.asObservable();
  }
}
