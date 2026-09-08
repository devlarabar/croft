import { db, schema } from "@croft/core";
import { asc } from "drizzle-orm";

export function getUsers() {
  return db.select().from(schema.dashboardUsers).orderBy(asc(schema.dashboardUsers.username));
}
