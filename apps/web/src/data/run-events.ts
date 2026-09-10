import { db, decryptEventPayload, schema } from "@croft/core";
import { and, desc, eq, lt } from "drizzle-orm";

const EVENTS_PER_PAGE = 50;

export async function getRunEvents(runId: string, before?: number) {
  const rows = await db.select({ seq: schema.events.seq, type: schema.events.type, payload: schema.events.payload, createdAt: schema.events.createdAt })
    .from(schema.events).where(and(eq(schema.events.runId, runId), before ? lt(schema.events.seq, before) : undefined))
    .orderBy(desc(schema.events.seq)).limit(EVENTS_PER_PAGE + 1);
  const events = rows.slice(0, EVENTS_PER_PAGE).map((event) => ({ ...event, payload: decryptEventPayload(event.payload) }));
  const nextCursor = rows.length > EVENTS_PER_PAGE ? events.at(-1)?.seq : undefined;
  return { events, nextCursor };
}

export type RunEvent = Awaited<ReturnType<typeof getRunEvents>>["events"][number];
