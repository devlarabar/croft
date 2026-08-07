import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "passed"
  | "failed"
  | "partial"
  | "cap_hit"
  | "error";

export type RunMode = "test" | "review";

export interface StepResult {
  step: string;
  status: "pass" | "fail" | "not_reached";
  notes?: string;
  screenshots?: string[]; // names of screenshots taken during this step
}

export interface RunReport {
  summary: string;
  steps: StepResult[];
}

export interface ReviewFinding {
  title: string;
  pointsCost: number;
  detail: string;
  file: string;
  startLine: number;
  endLine: number;
}

export interface ReviewReport {
  score: number;
  summary: string;
  praise: string[];
  findings: ReviewFinding[];
  safeToMerge: boolean;
  breakingChanges: string;
}

// UUID ids: artifact keys are `<runId>/<filename>` on a public-read bucket,
// so ids must be unguessable.
export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  repo: text("repo").notNull(), // "owner/name"
  prNumber: integer("pr_number").notNull(),
  mode: text("mode").$type<RunMode>().notNull(),
  // Generate a plan from the diff without looking for one in the PR body.
  freshPlan: boolean("fresh_plan").notNull().default(false),
  status: text("status").$type<RunStatus>().notNull().default("queued"),
  previewUrl: text("preview_url"),
  providerId: text("provider_id").notNull(),
  model: text("model").notNull(),
  credentialId: uuid("credential_id").notNull(),
  report: jsonb("report").$type<RunReport | ReviewReport>(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const events = pgTable(
  "events",
  {
    runId: uuid("run_id").notNull(),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    artifactKey: text("artifact_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.seq] })],
);

export const webhookDeliveries = pgTable("webhook_deliveries", {
  deliveryId: text("delivery_id").primaryKey(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CredentialKind = "api_key" | "oauth";

export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: text("provider_id").notNull(),
  kind: text("kind").$type<CredentialKind>().notNull(),
  // AES-256-GCM ciphertext: the API key, or JSON {accessToken, refreshToken}.
  encrypted: text("encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface ActiveModel {
  providerId: string;
  model: string;
  credentialId: string;
}

export interface PreviewLogin {
  label?: string;
  loginUrl?: string;
  username: string;
  encryptedPassword: string;
}

export const config = pgTable("config", {
  id: integer("id").primaryKey().default(1),
  activeModel: jsonb("active_model").$type<ActiveModel>(),
  webhooksEnabled: boolean("webhooks_enabled").notNull().default(false),
  toolCallCap: integer("tool_call_cap").notNull().default(50),
  repos: jsonb("repos").$type<string[]>().notNull().default([]),
  allowedUsers: jsonb("allowed_users").$type<string[]>().notNull().default([]),
  previewLogins: jsonb("preview_logins")
    .$type<Record<string, PreviewLogin[]>>()
    .notNull()
    .default({}),
  // Markdown notes about each repo, injected into the agent's prompts.
  repoContext: jsonb("repo_context").$type<Record<string, string>>().notNull().default({}),
});
