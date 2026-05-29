CREATE TYPE "public"."streamer_platform" AS ENUM('kick', 'twitch');--> statement-breakpoint
CREATE TABLE "streamers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "streamers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"platform" "streamer_platform" NOT NULL,
	"avatar_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"streamer_id" integer,
	"pinned" boolean DEFAULT false NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_body_length_chk" CHECK (char_length("posts"."body") between 6 and 280),
	CONSTRAINT "posts_like_count_nonneg_chk" CHECK ("posts"."like_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_streamer_id_streamers_id_fk" FOREIGN KEY ("streamer_id") REFERENCES "public"."streamers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "streamers_platform_handle_lower_uq" ON "streamers" USING btree ("platform",lower("handle"));--> statement-breakpoint
CREATE INDEX "streamers_handle_lower_idx" ON "streamers" USING btree (lower("handle"));--> statement-breakpoint
CREATE INDEX "streamers_display_name_lower_idx" ON "streamers" USING btree (lower("display_name"));--> statement-breakpoint
CREATE INDEX "streamers_active_idx" ON "streamers" USING btree ("active");--> statement-breakpoint
CREATE INDEX "post_likes_post_idx" ON "post_likes" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "post_likes_user_idx" ON "post_likes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "post_likes_user_post_uq" ON "post_likes" USING btree ("user_id","post_id");--> statement-breakpoint
CREATE INDEX "posts_feed_idx" ON "posts" USING btree ("pinned","created_at","id");--> statement-breakpoint
CREATE INDEX "posts_user_idx" ON "posts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "posts_streamer_idx" ON "posts" USING btree ("streamer_id");