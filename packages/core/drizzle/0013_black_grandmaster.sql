CREATE TABLE "dashboard_users" (
	"github_id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	CONSTRAINT "dashboard_role" CHECK ("dashboard_users"."role" in ('user', 'member', 'admin')),
	CONSTRAINT "dashboard_owner" CHECK ("dashboard_users"."github_id" <> '122644200' or "dashboard_users"."role" = 'admin')
);
--> statement-breakpoint
INSERT INTO "dashboard_users" ("github_id", "username", "role") VALUES ('122644200', 'devlarabar', 'admin');
