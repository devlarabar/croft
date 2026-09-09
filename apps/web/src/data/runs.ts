import { db, schema } from "@croft/core";
import { count, desc, eq } from "drizzle-orm";
import { RUNS_PER_PAGE, runFilterSchema, runPageSchema } from "../run-pagination";

export async function getRuns(pageValue: string | undefined, statusValue?: string) {
  const requestedPage = runPageSchema.parse(pageValue ?? "1");
  const status = runFilterSchema.catch("all").parse(statusValue);
  const where = status === "all" ? undefined : eq(schema.runs.status, status);
  const [result] = await db.select({ total: count() }).from(schema.runs).where(where);
  const total = result.total;
  const pageTotal = Math.max(1, Math.ceil(total / RUNS_PER_PAGE));
  const page = Math.min(requestedPage, pageTotal);
  const runs = await db.select({
    id: schema.runs.id, repo: schema.runs.repo, prNumber: schema.runs.prNumber,
    mode: schema.runs.mode, model: schema.runs.model, status: schema.runs.status,
    error: schema.runs.error, createdAt: schema.runs.createdAt, finishedAt: schema.runs.finishedAt,
  }).from(schema.runs).where(where).orderBy(desc(schema.runs.createdAt), desc(schema.runs.id))
    .limit(RUNS_PER_PAGE).offset((page - 1) * RUNS_PER_PAGE);
  return { runs, page, pageTotal, total, status };
}

export async function getRun(id: string) {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, id));
  return run;
}
