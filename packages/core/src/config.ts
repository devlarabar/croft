import { db, schema } from "./db/client.js";

export type Config = typeof schema.config.$inferSelect;

export async function getConfig(): Promise<Config> {
  const rows = await db.select().from(schema.config);
  if (rows[0]) return rows[0];
  const inserted = await db.insert(schema.config).values({ id: 1 }).returning();
  return inserted[0]!;
}

export async function updateConfig(patch: Partial<Omit<Config, "id">>): Promise<void> {
  await getConfig(); // ensure row exists
  await db.update(schema.config).set(patch);
}
