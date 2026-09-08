import { z } from "zod";
import { redirect, route } from "../../../../http";
import { startRun } from "../../../../runs";

export const POST = route(async (request) => {
  const form = await request.formData();
  const [repo, number] = String(form.get("pr")).split("#");
  try {
    const result = await startRun({
      repo: z.string().parse(repo),
      prNumber: Number(number),
      mode: form.get("mode") === "review" ? "review" : "test",
      previewUrl: String(form.get("previewUrl") ?? "") || undefined,
      freshPlan: form.get("freshPlan") === "on",
    });
    if (!result.started) return redirect(`/new?error=${encodeURIComponent(result.reason)}`);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return redirect(`/new?error=${encodeURIComponent(error.message)}`);
  }
  return redirect("/runs");
});
