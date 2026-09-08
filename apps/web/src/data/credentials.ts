import { db, schema } from "@croft/core";
import { desc } from "drizzle-orm";

export function getCredentials() {
  return db.select().from(schema.credentials).orderBy(desc(schema.credentials.createdAt));
}
