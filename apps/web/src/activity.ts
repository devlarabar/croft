import { createHash, timingSafeEqual } from "node:crypto";
import { desc, isNotNull } from "drizzle-orm";
import type { Context } from "hono";
import { db, schema } from "@croft/core";

export async function getLatestActivity(ctx: Context): Promise<Response> {
  const apiKey = process.env.CROFT_API_KEY;
  if (!apiKey) return ctx.json({ error: "CROFT_API_KEY is not configured" }, 500);

  const expected = createHash("sha256").update(apiKey).digest();
  const supplied = createHash("sha256").update(ctx.req.header("x-api-key") ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) return ctx.json({ error: "unauthorized" }, 401);

  const [run] = await db
    .select({ activity: schema.runs.flavourText })
    .from(schema.runs)
    .where(isNotNull(schema.runs.flavourText))
    .orderBy(desc(schema.runs.createdAt))
    .limit(1);
  if (!run) return ctx.json({ error: "no runs found" }, 404);
  return ctx.json(run);
}
