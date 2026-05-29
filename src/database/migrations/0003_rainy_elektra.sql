CREATE TYPE "public"."onboarding_status" AS ENUM('incomplete', 'active');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_status" "onboarding_status" DEFAULT 'active' NOT NULL;