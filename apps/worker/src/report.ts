import type { RunReport, RunStatus } from "@croft/core";
import type { Screenshot } from "./browser.js";

const ICONS = { pass: "✅", fail: "❌", not_reached: "⏭️" } as const;

export function formatComment(opts: {
  status: RunStatus;
  report: RunReport | null;
  screenshots: Screenshot[];
  runUrl: string;
  generatedPlan: string | null;
}): string {
  const lines: string[] = [];
  let leftoverScreenshots = opts.screenshots;
  const heading =
    opts.status === "passed"
      ? "## Croft test run: ✅ passed"
      : opts.status === "failed"
        ? "## Croft test run: ❌ failed"
        : opts.status === "cap_hit"
          ? "## Croft test run: ⏳ stopped at budget cap"
          : "## Croft test run: ⚠️ error";
  lines.push(heading, "");
  if (opts.status === "cap_hit") {
    lines.push(
      "This run hit its tool-call budget cap before finishing. Results below cover what was reached; remaining steps are marked *not reached* (the app didn't fail — Croft ran out of budget).",
      "",
    );
  }
  if (opts.report) {
    if (!opts.report.steps.length) lines.push(opts.report.summary, "");
    if (opts.report.steps.length) {
      const byName = new Map(opts.screenshots.map((s) => [s.name, s.url]));
      const referenced = new Set<string>();
      lines.push("| Step | Result | Notes | Screenshots |", "| --- | --- | --- | --- |");
      for (const s of opts.report.steps) {
        const cell = (s.screenshots ?? [])
          .filter((name) => byName.has(name))
          .map((name) => {
            referenced.add(name);
            const url = byName.get(name)!;
            return `<a href="${url}"><img src="${url}" width="120" alt="${name}"></a>`;
          })
          .join(" ");
        lines.push(`| ${s.step.replaceAll("|", "\\|")} | ${ICONS[s.status]} ${s.status.replace("_", " ")} | ${(s.notes ?? "").replaceAll("|", "\\|")} | ${cell} |`);
      }
      lines.push("");
      leftoverScreenshots = opts.screenshots.filter((s) => !referenced.has(s.name));
    }
  }
  if (opts.generatedPlan) {
    lines.push(
      "<details><summary>Test plan (generated from the diff — the PR has no <code>## Test plan</code> section)</summary>",
      "",
      opts.generatedPlan,
      "",
      "</details>",
      "",
    );
  }
  if (leftoverScreenshots.length) {
    lines.push("<details><summary>Other screenshots</summary>", "");
    for (const s of leftoverScreenshots) lines.push(`![${s.name}](${s.url})`);
    lines.push("", "</details>", "");
  }
  lines.push(`▶️ [Watch the run video](${opts.runUrl})`);
  return lines.join("\n");
}
