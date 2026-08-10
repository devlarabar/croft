import { commentableLines } from "@croft/core";
import type { ReviewComment, ReviewReport, RunReport, RunStatus } from "@croft/core";
import type { Screenshot } from "./browser.js";

// Splits a review into the summary body and its inline comments. A finding
// anchored outside the diff can't be posted inline (GitHub rejects the whole
// review), so it falls back into the body.
export function formatReview(
  report: ReviewReport,
  diff: string,
): { body: string; comments: ReviewComment[] } {
  const commentable = commentableLines(diff);
  const comments: ReviewComment[] = [];
  const orphans: string[] = [];
  for (const finding of report.findings) {
    const lines = commentable.get(finding.file);
    const prefix = finding.agreedWith ? `Agreed with ${finding.agreedWith}: ` : "";
    const body = `${prefix}**${finding.title} (-${finding.pointsCost}pts)**\n\n${finding.detail}`;
    if (lines?.has(finding.endLine)) {
      comments.push({
        path: finding.file,
        line: finding.endLine,
        startLine: lines.has(finding.startLine) && finding.startLine < finding.endLine ? finding.startLine : undefined,
        body,
      });
    } else {
      orphans.push(`${body}\n- \`${finding.file}:${finding.startLine}-${finding.endLine}\``);
    }
  }

  const lines = [`## Croft review: ${report.score}/100`, "", report.summary, ""];
  if (report.praise.length) {
    lines.push("**What's good**", "", ...report.praise.map((item) => `- ${item}`), "");
  }
  if (!report.findings.length) lines.push("No findings.", "");
  if (comments.length) {
    lines.push(`${comments.length} finding${comments.length === 1 ? "" : "s"} are inline on the diff.`, "");
  }
  if (orphans.length) {
    lines.push("**Findings outside the diff**", "", ...orphans.map((item) => `${item}\n`));
  }
  lines.push(
    report.safeToMerge ? "**Safe to merge into main**." : "**Not safe to merge into main yet.**",
    report.breakingChanges,
  );
  return { body: lines.join("\n"), comments };
}

const ICONS = { pass: "✅", fail: "❌", not_reached: "⏭️" } as const;

const HEADINGS: Partial<Record<RunStatus, string>> = {
  passed: "## Croft test run: ✅ passed",
  failed: "## Croft test run: ❌ failed",
  partial: "## Croft test run: ⏭️ partially completed",
  cap_hit: "## Croft test run: ⏳ stopped at budget cap",
};

export function formatComment(opts: {
  status: RunStatus;
  report: RunReport | null;
  screenshots: Screenshot[];
  runUrl: string;
  generatedPlan: string | null;
  error: string | null;
}): string {
  const lines: string[] = [];
  let leftoverScreenshots = opts.screenshots;
  lines.push(HEADINGS[opts.status] ?? "## Croft test run: ⚠️ error", "");
  if (opts.status === "partial") {
    lines.push(
      "More steps were skipped than passed. Nothing failed, but the run covered only part of the plan — see the notes on the skipped steps.",
      "",
    );
  }
  if (opts.status === "cap_hit") {
    lines.push(
      "This run hit its tool-call budget cap before finishing. Results below cover what was reached; remaining steps are marked *not reached* (the app didn't fail — Croft ran out of budget).",
      "",
    );
  }
  if (opts.status === "error" && opts.error) {
    lines.push("<details><summary>Error</summary>", "", "```", opts.error, "```", "", "</details>", "");
  }
  if (opts.report) {
    if (!opts.report.steps.length) lines.push(opts.report.summary, "");
    if (opts.report.steps.length) {
      const byName = new Map(opts.screenshots.map((shot) => [shot.name, shot.url]));
      // The tool prepends a numeric counter to the model's chosen name; accept
      // either form so a step's screenshots don't fall through to "other".
      const resolve = (name: string) =>
        byName.has(name) ? name : opts.screenshots.find((shot) => shot.name.endsWith(`-${name}`))?.name;
      const referenced = new Set<string>();
      lines.push("| Step | Result | Notes | Screenshots |", "| --- | --- | --- | --- |");
      for (const step of opts.report.steps) {
        const cell = (step.screenshots ?? [])
          .map(resolve)
          .filter((name): name is string => name !== undefined)
          .map((name) => {
            referenced.add(name);
            const url = byName.get(name)!;
            return `<a href="${url}"><img src="${url}" width="120" alt="${name}"></a>`;
          })
          .join(" ");
        lines.push(`| ${step.step.replaceAll("|", "\\|")} | ${ICONS[step.status]} ${step.status.replace("_", " ")} | ${(step.notes ?? "").replaceAll("|", "\\|")} | ${cell} |`);
      }
      lines.push("");
      leftoverScreenshots = opts.screenshots.filter((shot) => !referenced.has(shot.name));
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
    for (const shot of leftoverScreenshots) lines.push(`![${shot.name}](${shot.url})`);
    lines.push("", "</details>", "");
  }
  lines.push(`▶️ [Watch the run video](${opts.runUrl})`);
  return lines.join("\n");
}
