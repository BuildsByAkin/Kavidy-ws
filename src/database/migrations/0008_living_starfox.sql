CREATE TYPE "public"."bet_entry_status" AS ENUM('pending', 'won', 'lost', 'void');--> statement-breakpoint
CREATE TYPE "public"."bet_pick_direction" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TYPE "public"."bet_pick_status" AS ENUM('pending', 'won', 'lost', 'void');--> statement-breakpoint
CREATE TABLE "bet_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "bet_entry_status" DEFAULT 'pending' NOT NULL,
	"currency" "wallet_currency" NOT NULL,
	"pick_count" integer NOT NULL,
	"stake_amount_cents" bigint NOT NULL,
	"payout_multiplier_x100" integer NOT NULL,
	"potential_payout_cents" bigint NOT NULL,
	"actual_payout_cents" bigint,
	"idempotency_key" text NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bet_picks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_id" uuid NOT NULL,
	"market_id" text NOT NULL,
	"direction" "bet_pick_direction" NOT NULL,
	"status" "bet_pick_status" DEFAULT 'pending' NOT NULL,
	"market_question" text NOT NULL,
	"market_resolved_status" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bet_entries" ADD CONSTRAINT "bet_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_picks" ADD CONSTRAINT "bet_picks_entry_id_bet_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."bet_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bet_entries_user_idem_uq" ON "bet_entries" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bet_entries_user_created_idx" ON "bet_entries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "bet_entries_status_idx" ON "bet_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bet_entries_user_status_idx" ON "bet_entries" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bet_picks_entry_market_uq" ON "bet_picks" USING btree ("entry_id","market_id");--> statement-breakpoint
CREATE INDEX "bet_picks_entry_idx" ON "bet_picks" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "bet_picks_market_idx" ON "bet_picks" USING btree ("market_id");--> statement-breakpoint
CREATE INDEX "bet_picks_market_status_idx" ON "bet_picks" USING btree ("market_id","status");