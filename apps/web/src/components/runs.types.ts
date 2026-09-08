import type { DashboardRole, schema } from "@croft/core";

export type Run = typeof schema.runs.$inferSelect;

export interface RunsPageProps {
  runs: Run[];
  page: number;
  hasNext: boolean;
  role: DashboardRole;
}

export interface RunDetailPageProps {
  run: Run;
  videoUrl: string;
  role: DashboardRole;
}
