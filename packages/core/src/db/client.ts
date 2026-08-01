import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

// Serverless SQL is pooled Postgres: keep every statement self-contained,
// no SET / search_path.
const sql = postgres(process.env.DATABASE_URL!, { max: 5, prepare: false });

export const db = drizzle(sql, { schema });
export { schema };
