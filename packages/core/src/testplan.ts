// Finds a `## Test plan` header (case-insensitive) in the PR body. The plan is
// everything under it until the next header of the same or higher level
// (## or #) or end of body; ###+ inside belongs to the plan.
export function extractTestPlan(body: string | null | undefined): string | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^(##?)\s+test plan\s*$/i.test(l.trim()));
  if (start === -1) return null;
  const level = lines[start]!.trim().match(/^#+/)![0].length;
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const h = line.trim().match(/^(#+)\s/);
    if (h && h[1]!.length <= level) break;
    section.push(line);
  }
  const plan = section.join("\n").trim();
  return plan.length > 0 ? plan : null;
}
