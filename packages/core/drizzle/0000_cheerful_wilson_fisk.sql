CREATE TABLE "config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"active_model" jsonb,
	"webhooks_enabled" boolean DEFAULT false NOT NULL,
	"repos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_users" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview_logins" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text NOT NULL,
	"encrypted" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"artifact_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo" text NOT NULL,
	"pr_number" integer NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"preview_url" text,
	"provider_id" text NOT NULL,
	"model" text NOT NULL,
	"report" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
