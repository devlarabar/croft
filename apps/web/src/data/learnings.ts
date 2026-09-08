import { db, schema } from "@croft/core";
import { desc } from "drizzle-orm";

export function getLearnings() {
  return db.select().from(schema.learnings).orderBy(desc(schema.learnings.createdAt));
}
