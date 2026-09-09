import type { DashboardRole, schema } from "@croft/core";

export type Run = typeof schema.runs.$inferSelect;
export type RunListItem = Pick<Run, "id" | "repo" | "prNumber" | "mode" | "model" | "status" | "error" | "createdAt" | "finishedAt">;

export interface RunsPageProps {
  runs: RunListItem[];
  page: number;
  pageTotal: number;
  total: number;
  status: string;
  role: DashboardRole;
}

export interface RunDetailPageProps {
  run: Run;
  videoUrl: string;
  role: DashboardRole;
}
