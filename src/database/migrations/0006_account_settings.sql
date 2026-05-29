ALTER TABLE "users" ADD COLUMN "notification_prefs" jsonb DEFAULT '{"emailDigest":true,"marketAlerts":true}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_display_name_lower_uq" ON "users" USING btree (lower("display_name")) WHERE "users"."display_name" is not null;