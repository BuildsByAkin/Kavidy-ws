import { Injectable } from '@nestjs/common';
import { EligibilityService } from '../common/geo/eligibility.service';
import type { UserRow } from '../database/schema/users';
import {
  DailyBonusService,
  type DailyBonusStatus,
} from './daily-bonus.service';
import { DepositsService, type FirstPurchaseOffer } from './deposits.service';
import { LedgerService, type BalanceSnapshot } from './ledger.service';

export interface WalletOverview {
  balance: BalanceSnapshot;
  dailyBonus: DailyBonusStatus;
  firstPurchaseOffer: FirstPurchaseOffer;
  restricted: boolean;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly dailyBonus: DailyBonusService,
    private readonly deposits: DepositsService,
    private readonly eligibility: EligibilityService,
  ) {}

  async getOverview(user: UserRow): Promise<WalletOverview> {
    await this.ledger.ensureBalanceRow(user.id);
    const [balance, dailyBonus, firstPurchaseOffer] = await Promise.all([
      this.ledger.getBalance(user.id),
      this.dailyBonus.getStatus(user.id),
      this.deposits.getFirstPurchaseOffer(user.id),
    ]);
    const restricted = Boolean(
      user.state && this.eligibility.isStateRestricted(user.state),
    );
    return { balance, dailyBonus, firstPurchaseOffer, restricted };
  }

  assertMoneyActionAllowed(user: UserRow): void {
    this.eligibility.assertMoneyActionAllowed({
      country: user.country,
      state: user.state,
    });
  }
}
