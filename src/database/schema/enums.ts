import { pgEnum } from 'drizzle-orm/pg-core';

export const userStatusEnum = pgEnum('user_status', [
  'active',
  'suspended',
  'banned',
  'deleted',
]);

export const userRoleEnum = pgEnum('user_role', ['user', 'admin', 'curator']);

export const onboardingStatusEnum = pgEnum('onboarding_status', [
  'incomplete',
  'active',
]);

export const oauthProviderEnum = pgEnum('oauth_provider', ['google']);

export const walletCurrencyEnum = pgEnum('wallet_currency', [
  'sweeps_cashable',
  'sweeps_locked',
]);

export const ledgerKindEnum = pgEnum('ledger_kind', [
  'deposit_purchase',
  'deposit_first_purchase_bonus',
  'promo_redeem',
  'daily_bonus',
  'bet_stake',
  'bet_payout',
  'bet_refund',
  'unlock_sweeps',
  'cashout_request',
  'cashout_reversal',
  'admin_adjustment',
]);

export const depositStatusEnum = pgEnum('deposit_status', [
  'pending',
  'completed',
  'failed',
  'expired',
  'refunded',
]);

export const promoKindEnum = pgEnum('promo_kind', ['bonus_sweeps_locked']);

export const streamerPlatformEnum = pgEnum('streamer_platform', [
  'kick',
  'twitch',
]);
