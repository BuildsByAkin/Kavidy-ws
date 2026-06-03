import {
  EXPOSURE_MAX_SIDE_PAYOUT_CENTS,
  EXPOSURE_MIN_STAKE_CENTS,
  EXPOSURE_SKEW_THRESHOLD,
  MarketExposureService,
} from './market-exposure.service';

const MARKET_ID = 'streamer:plays_slots:abc1';

function makePickRow(direction: 'yes' | 'no', potentialPayoutCents: number, stakeAmountCents: number) {
  return { direction, potentialPayoutCents, stakeAmountCents };
}

function makeDb(opts: {
  pickRows?: ReturnType<typeof makePickRow>[];
  updateResult?: { id: string }[];
}) {
  const { pickRows = [], updateResult = [] } = opts;

  const selectChain: any = {
    from: jest.fn().mockReturnThis(),
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockResolvedValue(pickRows),
  };

  const updateChain: any = {
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    returning: jest.fn().mockResolvedValue(updateResult),
  };

  const db: any = {
    select: jest.fn().mockReturnValue(selectChain),
    update: jest.fn().mockReturnValue(updateChain),
  };

  return { db, selectChain, updateChain };
}

describe('MarketExposureService', () => {
  describe('computeExposure', () => {
    it('returns null when no pending picks exist for the market', async () => {
      const { db } = makeDb({ pickRows: [] });
      const svc = new MarketExposureService(db);

      const result = await svc.computeExposure(MARKET_ID);
      expect(result).toBeNull();
    });

    it('correctly sums YES and NO potential payouts', async () => {
      const { db } = makeDb({
        pickRows: [
          makePickRow('yes', 2500, 500),
          makePickRow('yes', 2500, 500),
          makePickRow('no', 1000, 200),
        ],
      });
      const svc = new MarketExposureService(db);

      const result = await svc.computeExposure(MARKET_ID);
      expect(result).not.toBeNull();
      expect(result!.yesPayoutCents).toBe(5000);
      expect(result!.noPayoutCents).toBe(1000);
      expect(result!.totalStakeCents).toBe(1200);
    });

    it('calculates skew correctly', async () => {
      const { db } = makeDb({
        pickRows: [
          makePickRow('yes', 8000, 1000),
          makePickRow('no', 2000, 500),
        ],
      });
      const svc = new MarketExposureService(db);

      const result = await svc.computeExposure(MARKET_ID);
      expect(result!.skew).toBeCloseTo(0.8);
      expect(result!.dominantDirection).toBe('yes');
    });

    it('sets dominantDirection to null when yes and no payouts are equal', async () => {
      const { db } = makeDb({
        pickRows: [
          makePickRow('yes', 5000, 500),
          makePickRow('no', 5000, 500),
        ],
      });
      const svc = new MarketExposureService(db);

      const result = await svc.computeExposure(MARKET_ID);
      expect(result!.dominantDirection).toBeNull();
      expect(result!.skew).toBe(0.5);
    });

    it('sets dominantDirection to no when no side dominates', async () => {
      const { db } = makeDb({
        pickRows: [
          makePickRow('no', 9000, 1000),
          makePickRow('yes', 1000, 200),
        ],
      });
      const svc = new MarketExposureService(db);

      const result = await svc.computeExposure(MARKET_ID);
      expect(result!.dominantDirection).toBe('no');
    });
  });

  describe('checkAndCloseIfNeeded', () => {
    it('is a no-op when no picks exist', async () => {
      const { db, updateChain } = makeDb({ pickRows: [] });
      const svc = new MarketExposureService(db);

      await svc.checkAndCloseIfNeeded(MARKET_ID);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('is a no-op when total stake is below minimum volume threshold', async () => {
      const { db, updateChain } = makeDb({
        pickRows: [
          makePickRow('yes', 2500, 200),
          makePickRow('yes', 2500, 200),
        ],
      });
      const svc = new MarketExposureService(db);

      await svc.checkAndCloseIfNeeded(MARKET_ID);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('is a no-op when volume is sufficient but skew is balanced', async () => {
      const { db, updateChain } = makeDb({
        pickRows: [
          makePickRow('yes', 5000, 2600),
          makePickRow('no', 5000, 2600),
        ],
      });
      const svc = new MarketExposureService(db);

      await svc.checkAndCloseIfNeeded(MARKET_ID);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('closes the market when skew exceeds threshold with sufficient volume', async () => {
      const highYesPayout = 9000;
      const lowNoPayout = 1000;
      const totalStake = EXPOSURE_MIN_STAKE_CENTS + 1000;

      const pickCount = Math.ceil(totalStake / 500);
      const picks = [
        makePickRow('yes', highYesPayout, Math.floor(totalStake * 0.85)),
        makePickRow('no', lowNoPayout, Math.floor(totalStake * 0.15)),
      ];

      const { db, updateChain } = makeDb({
        pickRows: picks,
        updateResult: [{ id: MARKET_ID }],
      });
      const svc = new MarketExposureService(db);

      await svc.checkAndCloseIfNeeded(MARKET_ID);
      expect(db.update).toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'closed' }),
      );
    });

    it('closes the market when dominant side payout exceeds cap regardless of skew', async () => {
      const picks = [
        makePickRow('yes', EXPOSURE_MAX_SIDE_PAYOUT_CENTS + 1, EXPOSURE_MIN_STAKE_CENTS),
        makePickRow('no', EXPOSURE_MAX_SIDE_PAYOUT_CENTS - 100, EXPOSURE_MIN_STAKE_CENTS),
      ];

      const { db, updateChain } = makeDb({
        pickRows: picks,
        updateResult: [{ id: MARKET_ID }],
      });
      const svc = new MarketExposureService(db);

      await svc.checkAndCloseIfNeeded(MARKET_ID);
      expect(db.update).toHaveBeenCalled();
      expect(updateChain.set).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'closed' }),
      );
    });

    it('does not log closure when market was already closed (update returns empty)', async () => {
      const picks = [
        makePickRow('yes', 9000, 3000),
        makePickRow('no', 1000, 3000),
      ];

      const { db } = makeDb({
        pickRows: picks,
        updateResult: [],
      });
      const svc = new MarketExposureService(db);

      await expect(svc.checkAndCloseIfNeeded(MARKET_ID)).resolves.not.toThrow();
      expect(db.update).toHaveBeenCalled();
    });

    it('is a no-op when skew is just below threshold', async () => {
      const belowThresholdSkew = EXPOSURE_SKEW_THRESHOLD - 0.01;
      const dominant = Math.round(belowThresholdSkew * 10000);
      const other = 10000 - dominant;

      const { db } = makeDb({
        pickRows: [
          makePickRow('yes', dominant, EXPOSURE_MIN_STAKE_CENTS),
          makePickRow('no', other, 500),
        ],
      });
      const svc = new MarketExposureService(db);

      await svc.checkAndCloseIfNeeded(MARKET_ID);
      expect(db.update).not.toHaveBeenCalled();
    });
  });
});
