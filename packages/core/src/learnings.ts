import { desc, eq } from "drizzle-orm";
import { db, schema } from "./db/client.js";

export type Learning = typeof schema.learnings.$inferSelect;

// Hard caps: the whole set ships in every review and Q&A prompt.
export const LEARNING_MAX_CHARS = 200;
export const LEARNING_CAP = 50;

export async function listLearnings(repo: string): Promise<Learning[]> {
  return db
    .select()
    .from(schema.learnings)
    .where(eq(schema.learnings.repo, repo))
    .orderBy(desc(schema.learnings.createdAt));
}

export async function addLearning(row: {
  repo: string;
  text: string;
  sourceUrl?: string;
  author?: string;
}): Promise<void> {
  const existing = await listLearnings(row.repo);
  if (existing.length >= LEARNING_CAP) {
    throw new Error(`${row.repo} already has ${LEARNING_CAP} learnings — delete some in the dashboard first.`);
  }
  await db.insert(schema.learnings).values({ ...row, text: row.text.trim() });
}

// Numbered so a reviewer can point at one; empty set renders nothing.
export function learningsBlock(learnings: string[]): string {
  if (learnings.length === 0) return "";
  return `
Learnings this repository's maintainers have taught you. Apply them; they outrank your defaults.
<learnings>
${learnings.map((text, index) => `${index + 1}. ${text}`).join("\n")}
</learnings>
`;
}
