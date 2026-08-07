// Regenerates src/skills.ts from the markdown sources of truth (skills/ and
// docs/code-standards.md). Runs as part of `pnpm build` so the worker's
// prompts can never drift from the files.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function load(...path) {
  const md = readFileSync(join(root, ...path), "utf8");
  return md.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

const consts = {
  TEST_PLAN_SKILL: load("skills", "test-plan.md"),
  REVIEW_SKILL: load("skills", "review.md"),
  CODE_STANDARDS: load("docs", "code-standards.md"),
};

writeFileSync(
  join(root, "packages", "core", "src", "skills.ts"),
  `// GENERATED from skills/*.md and docs/code-standards.md by scripts/gen-skills.mjs — do not edit.
${Object.entries(consts)
  .map(([name, body]) => `export const ${name} = ${JSON.stringify(body)};`)
  .join("\n")}
`,
);
