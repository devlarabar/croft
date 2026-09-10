import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "./db/client.js";
import { encryptEventPayload } from "./event-payload.js";

const plaintext = sql`jsonb_typeof(${schema.events.payload}) <> 'string'`;
let encrypted = 0;
try {
  while (true) {
    const rows = await db.select().from(schema.events).where(plaintext).limit(100);
    if (!rows.length) break;
    for (const row of rows) {
      await db.update(schema.events).set({ payload: encryptEventPayload(row.payload) }).where(and(
        eq(schema.events.runId, row.runId), eq(schema.events.seq, row.seq), plaintext,
      ));
      encrypted++;
    }
    console.log(`Encrypted ${encrypted} event payloads`);
  }
} finally {
  await db.$client.end();
}
