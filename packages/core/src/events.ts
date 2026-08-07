import { eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { redactDeep } from "./redact.js";
import { isTransientDbError, withRetry } from "./retry.js";

export function eventWriter(runId: string) {
  let seq = 0;
  return async (type: string, payload: unknown, artifactKey?: string) => {
    const currentSeq = ++seq;
    await withRetry(
      () =>
        db.insert(schema.events).values({
          runId,
          seq: currentSeq,
          type,
          payload: redactDeep(payload) as object,
          artifactKey,
        }),
      { attempts: 3, shouldRetry: isTransientDbError },
    );
  };
}

export async function listEvents(runId: string) {
  return db
    .select()
    .from(schema.events)
    .where(eq(schema.events.runId, runId))
    .orderBy(sql`${schema.events.seq} asc`);
}
