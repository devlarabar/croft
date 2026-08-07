import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AgentTool } from "@croft/core/llm/loop";

const exec = promisify(execFile);
const MAX_TOOL_OUTPUT = 20_000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

// Shallow, blobless checkout of the PR head. The token is passed in the fetch
// URL rather than a stored remote so it never lands in .git/config.
export async function checkoutPr(repo: string, headSha: string, token: string): Promise<string> {
  const dir = join(process.env.ARTIFACTS_DIR ?? "/artifacts", "checkout");
  await exec("git", ["init", "--quiet", dir]);
  await git(dir, [
    "fetch",
    "--depth",
    "50",
    "--filter=blob:none",
    `https://x-access-token:${token}@github.com/${repo}.git`,
    headSha,
  ]);
  await git(dir, ["checkout", "--quiet", "FETCH_HEAD"]);
  return dir;
}

function clip(text: string): string {
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}\n…(truncated)` : text;
}

// Read-only by construction: no bash, no writes, no install step — the
// checkout is the PR author's code and may be hostile.
export function repoTools(dir: string): AgentTool[] {
  const inside = (path: string): string | null => {
    const full = resolve(dir, path);
    return full === dir || full.startsWith(`${dir}/`) ? full : null;
  };
  return [
    {
      def: {
        name: "read_file",
        description:
          "Read a file from the PR branch checkout, with line numbers. Paths are relative to the repository root.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            startLine: { type: "number", description: "1-based; omit to read from the top" },
            endLine: { type: "number" },
          },
          required: ["path"],
        },
      },
      schema: z.object({ path: z.string(), startLine: z.number().optional(), endLine: z.number().optional() }),
      async execute(args) {
        const { path, startLine, endLine } = args as { path: string; startLine?: number; endLine?: number };
        const full = inside(path);
        if (!full) return [{ type: "text", text: `Refused: ${path} is outside the repository.` }];
        const lines = (await readFile(full, "utf8")).split("\n");
        const from = startLine ?? 1;
        const numbered = lines
          .slice(from - 1, endLine ?? lines.length)
          .map((line, index) => `${from + index}\t${line}`)
          .join("\n");
        return [{ type: "text", text: clip(numbered) }];
      },
    },
    {
      def: {
        name: "grep",
        description:
          "Search the PR branch checkout for a regular expression. Returns matching lines as path:line:text. Use it to find how similar features are implemented elsewhere in the repo; search for filenames with a pathspec and the pattern '.'.",
        inputSchema: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            pathspec: { type: "string", description: "Optional glob to limit the search, e.g. 'src/**/*.ts'" },
          },
          required: ["pattern"],
        },
      },
      schema: z.object({ pattern: z.string(), pathspec: z.string().optional() }),
      async execute(args) {
        const { pattern, pathspec } = args as { pattern: string; pathspec?: string };
        // git grep exits 1 with no output when nothing matches.
        const out = await git(dir, [
          "grep",
          "--no-color",
          "-n",
          "-I",
          "-E",
          "-e",
          pattern,
          ...(pathspec ? ["--", pathspec] : []),
        ]).catch(() => "");
        return [{ type: "text", text: out ? clip(out) : "No matches." }];
      },
    },
  ];
}
