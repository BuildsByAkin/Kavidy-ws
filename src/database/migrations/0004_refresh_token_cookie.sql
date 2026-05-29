ALTER TABLE "refresh_tokens" ADD COLUMN "absolute_expires_at" timestamp with time zone DEFAULT (now() + interval '90 days') NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ALTER COLUMN "absolute_expires_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "last_used_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "remember_me" boolean DEFAULT true NOT NULL;