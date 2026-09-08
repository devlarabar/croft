import { addLearning, db, getConfig, LEARNING_MAX_CHARS, schema } from "@croft/core";
import { eq } from "drizzle-orm";
import { redirect, route } from "../../../../http";

export const POST = route(async (request) => {
  const form = await request.formData();
  const cfg = await getConfig();
  const existing = await db.select().from(schema.learnings);
  for (const learning of existing) {
    const field = form.get(`learning_${learning.id}`);
    if (field === null) continue;
    const text = String(field).trim().slice(0, LEARNING_MAX_CHARS);
    if (!text) {
      await db.delete(schema.learnings).where(eq(schema.learnings.id, learning.id));
    } else if (text !== learning.text) {
      await db.update(schema.learnings).set({ text }).where(eq(schema.learnings.id, learning.id));
    }
  }
  for (const repo of cfg.repos) {
    const text = String(form.get(`new_${repo}`) ?? "").trim().slice(0, LEARNING_MAX_CHARS);
    if (text) await addLearning({ repo, text });
  }
  return redirect("/learnings?notice=Saved");
});
