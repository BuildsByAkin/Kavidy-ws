import { firstValueFrom, take, toArray } from 'rxjs';
import type { MarketChangedEvent } from './markets-events.service';
import { MarketsEventsService } from './markets-events.service';

function makeEvent(id = 'market:1'): MarketChangedEvent {
  return {
    type: 'market.changed',
    data: {
      id,
      creatorId: 'streamer',
      creatorDisplayName: 'Streamer',
      creatorPrimaryPlatform: 'twitch',
      question: 'Will they win?',
      kind: 'win',
      status: 'open',
      confidenceLevel: 'medium',
      opensAt: '2026-06-03T18:00:00.000Z',
      resolvesAt: '2026-06-04T18:00:00.000Z',
      generatedAt: '2026-06-03T17:58:00.000Z',
      resolvedAt: null,
      evidence: [],
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    },
  };
}

describe('MarketsEventsService', () => {
  let service: MarketsEventsService;

  beforeEach(() => {
    service = new MarketsEventsService();
  });

  it('emits events to subscribers', async () => {
    const event = makeEvent();
    const received$ = service.events$.pipe(take(1));
    const promise = firstValueFrom(received$);

    service.emit(event);

    const received = await promise;
    expect(received).toEqual(event);
  });

  it('delivers events to multiple concurrent subscribers', async () => {
    const event = makeEvent();

    const p1 = firstValueFrom(service.events$.pipe(take(1)));
    const p2 = firstValueFrom(service.events$.pipe(take(1)));

    service.emit(event);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(event);
    expect(r2).toEqual(event);
  });

  it('delivers multiple events in order', async () => {
    const eventA = makeEvent('market:a');
    const eventB = makeEvent('market:b');

    const collected$ = service.events$.pipe(take(2), toArray());
    const promise = firstValueFrom(collected$);

    service.emit(eventA);
    service.emit(eventB);

    const received = await promise;
    expect(received[0].data.id).toBe('market:a');
    expect(received[1].data.id).toBe('market:b');
  });

  it('does not replay past events to new subscribers', async () => {
    const event = makeEvent();
    service.emit(event);

    const received: MarketChangedEvent[] = [];
    const sub = service.events$.subscribe((e) => received.push(e));

    expect(received).toHaveLength(0);
    sub.unsubscribe();
  });
});
