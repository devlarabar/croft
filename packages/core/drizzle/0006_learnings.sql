CREATE TABLE "learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo" text NOT NULL,
	"text" text NOT NULL,
	"source_url" text,
	"author" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learnings_text_len" CHECK (char_length("learnings"."text") <= 200)
);
