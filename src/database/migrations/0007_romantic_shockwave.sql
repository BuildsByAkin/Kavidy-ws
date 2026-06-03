CREATE TYPE "public"."creator_platform" AS ENUM('twitch', 'kick', 'youtube');--> statement-breakpoint
CREATE TYPE "public"."market_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('proposed', 'open', 'resolved_yes', 'resolved_no', 'void', 'abandoned');--> statement-breakpoint
CREATE TABLE "markets" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_id" text NOT NULL,
	"creator_display_name" text NOT NULL,
	"creator_primary_platform" "creator_platform" NOT NULL,
	"question" text NOT NULL,
	"kind" text NOT NULL,
	"status" "market_status" DEFAULT 'proposed' NOT NULL,
	"confidence_level" "market_confidence" NOT NULL,
	"opens_at" timestamp with time zone NOT NULL,
	"resolves_at" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "markets_creator_idx" ON "markets" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "markets_status_idx" ON "markets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "markets_resolves_at_idx" ON "markets" USING btree ("resolves_at");--> statement-breakpoint
CREATE INDEX "markets_creator_status_idx" ON "markets" USING btree ("creator_id","status");