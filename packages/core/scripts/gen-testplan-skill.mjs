// Regenerates src/testplan-skill.ts from skills/test-plan.md (the source
// of truth). Runs as part of `pnpm build` so the worker's prompt can never
// drift from the skill file.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const md = readFileSync(join(root, "skills", "test-plan.md"), "utf8");
const body = md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();

writeFileSync(
  join(root, "packages", "core", "src", "testplan-skill.ts"),
  `// GENERATED from skills/test-plan.md by scripts/gen-testplan-skill.mjs — do not edit.
export const TEST_PLAN_SKILL = ${JSON.stringify(body)};
`,
);
