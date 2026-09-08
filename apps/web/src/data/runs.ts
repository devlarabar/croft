import { db, schema } from "@croft/core";
import { desc, eq } from "drizzle-orm";
import { RUNS_PER_PAGE, runPageSchema } from "../run-pagination";

export async function getRuns(pageValue: string | undefined) {
  const page = runPageSchema.parse(pageValue ?? "1");
  const rows = await db.select().from(schema.runs).orderBy(desc(schema.runs.createdAt))
    .limit(RUNS_PER_PAGE + 1).offset((page - 1) * RUNS_PER_PAGE);
  return { runs: rows.slice(0, RUNS_PER_PAGE), page, hasNext: rows.length > RUNS_PER_PAGE };
}

export async function getRun(id: string) {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, id));
  return run;
}
