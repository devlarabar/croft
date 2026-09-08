import { createHash, timingSafeEqual } from "node:crypto";
import { desc, isNotNull } from "drizzle-orm";
import { db, schema } from "@croft/core";

export async function getLatestActivity(request: Request): Promise<Response> {
  const apiKey = process.env.CROFT_API_KEY;
  if (!apiKey) return Response.json({ error: "CROFT_API_KEY is not configured" }, { status: 500 });

  const expected = createHash("sha256").update(apiKey).digest();
  const supplied = createHash("sha256").update(request.headers.get("x-api-key") ?? "").digest();
  if (!timingSafeEqual(expected, supplied)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const [run] = await db
    .select()
    .from(schema.runs)
    .where(isNotNull(schema.runs.flavourText))
    .orderBy(desc(schema.runs.createdAt))
    .limit(1);
  if (!run) return Response.json({ error: "no runs found" }, { status: 404 });
  return Response.json(run);
}
