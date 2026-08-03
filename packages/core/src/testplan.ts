// Judges whether a PR-body test plan is a real reviewer-facing test plan
// (steps to run against the deployment to verify the change) rather than
// a report of CI results. Cheap gate before diff-based generation.
export const PLAN_TRIAGE_SKILL = `
You judge whether the text under a PR's "Test plan" heading is an actual
test plan: instructions a reviewer follows against a deployment to
verify the new functionality works.

USABLE means it contains at least one concrete step for the reviewer to
perform and something to verify as a result. Steps may involve the UI,
API calls, network inspection, or other hands-on checks.

UNUSABLE means it only reports work already done: "tests pass",
"typecheck clean", suite/CI results, coverage numbers, or descriptions
of the change with nothing for the reviewer to do.

Reply with exactly one word: USABLE or UNUSABLE.
`;

// Finds a `## Test plan` header (case-insensitive) in the PR body. The plan is
// everything under it until the next header of the same or higher level
// (## or #) or end of body; ###+ inside belongs to the plan.
export function extractTestPlan(body: string | null | undefined): string | null {
  if (!body) return null;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^(##?)\s+test plan\s*$/i.test(line.trim()));
  if (start === -1) return null;
  const level = lines[start]!.trim().match(/^#+/)![0].length;
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const header = line.trim().match(/^(#+)\s/);
    if (header && header[1]!.length <= level) break;
    section.push(line);
  }
  const plan = section.join("\n").trim();
  return plan.length > 0 ? plan : null;
}
