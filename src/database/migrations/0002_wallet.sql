CREATE TYPE "public"."deposit_status" AS ENUM('pending', 'completed', 'failed', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('deposit_purchase', 'deposit_first_purchase_bonus', 'promo_redeem', 'daily_bonus', 'bet_stake', 'bet_payout', 'bet_refund', 'unlock_sweeps', 'cashout_request', 'cashout_reversal', 'admin_adjustment');--> statement-breakpoint
CREATE TYPE "public"."promo_kind" AS ENUM('bonus_sweeps_locked');--> statement-breakpoint
CREATE TYPE "public"."wallet_currency" AS ENUM('sweeps_cashable', 'sweeps_locked');--> statement-breakpoint
CREATE TABLE "balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sweeps_cashable_cents" bigint DEFAULT 0 NOT NULL,
	"sweeps_locked_cents" bigint DEFAULT 0 NOT NULL,
	"playthrough_remaining_cents" bigint DEFAULT 0 NOT NULL,
	"lifetime_deposits_cents" bigint DEFAULT 0 NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"currency" "wallet_currency" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"reference_type" text,
	"reference_id" text,
	"idempotency_key" text,
	"memo" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coin_packages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coin_packages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer NOT NULL,
	"sweeps_cents" bigint NOT NULL,
	"bonus_percent" smallint DEFAULT 0 NOT NULL,
	"badge" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_bonus_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"streak_days" integer DEFAULT 0 NOT NULL,
	"last_claimed_date" date,
	"last_awarded_sweeps_cents" bigint DEFAULT 0 NOT NULL,
	"total_claims" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"package_id" integer NOT NULL,
	"status" "deposit_status" DEFAULT 'pending' NOT NULL,
	"price_cents" integer NOT NULL,
	"base_sweeps_cents" bigint DEFAULT 0 NOT NULL,
	"bonus_sweeps_cents" bigint DEFAULT 0 NOT NULL,
	"first_purchase_applied" boolean DEFAULT false NOT NULL,
	"promo_code" text,
	"promo_sweeps_cents" bigint DEFAULT 0 NOT NULL,
	"provider_session_id" text,
	"provider_payment_ref" text,
	"provider_event_id" text,
	"idempotency_key" text NOT NULL,
	"metadata" jsonb,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "promo_codes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"description" text,
	"kind" "promo_kind" NOT NULL,
	"sweeps_cents" bigint DEFAULT 0 NOT NULL,
	"max_redemptions" integer,
	"max_per_user" integer DEFAULT 1 NOT NULL,
	"redemption_count" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"promo_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"sweeps_cents" bigint DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text,
	"status_code" smallint,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_bonus_state" ADD CONSTRAINT "daily_bonus_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_package_id_coin_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."coin_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wallet_ledger_user_idx" ON "wallet_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_ledger_user_currency_idx" ON "wallet_ledger" USING btree ("user_id","currency");--> statement-breakpoint
CREATE INDEX "wallet_ledger_reference_idx" ON "wallet_ledger" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_idem_uq" ON "wallet_ledger" USING btree ("user_id","kind","idempotency_key") WHERE "wallet_ledger"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "coin_packages_code_uq" ON "coin_packages" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_intents_user_idem_uq" ON "deposit_intents" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_intents_provider_session_uq" ON "deposit_intents" USING btree ("provider_session_id") WHERE "deposit_intents"."provider_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "deposit_intents_user_idx" ON "deposit_intents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "deposit_intents_status_idx" ON "deposit_intents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_uq" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "promo_redemptions_user_idx" ON "promo_redemptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_redemptions_user_promo_uq" ON "promo_redemptions" USING btree ("user_id","promo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_keys_scope_user_key_uq" ON "idempotency_keys" USING btree ("scope","user_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_keys_created_idx" ON "idempotency_keys" USING btree ("created_at");