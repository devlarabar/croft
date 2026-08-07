import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { AgentTool } from "@croft/core/llm/loop";

const exec = promisify(execFile);
const MAX_TOOL_OUTPUT = 20_000;

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await exec("git", args, { cwd, env, maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

// No --filter: a blobless fetch makes checkout and read_file pull blobs from
// the promisor remote, which runs without the credential helper. The token
// goes via the helper because git echoes fetch URLs in its error text.
export async function checkoutPr(repo: string, headSha: string, token: string): Promise<string> {
  const dir = join(process.env.ARTIFACTS_DIR ?? "/artifacts", "checkout");
  await exec("git", ["init", "--quiet", dir]);
  await git(
    dir,
    [
      "-c",
      "credential.helper=!f() { echo username=x-access-token; echo password=$CROFT_GITHUB_TOKEN; }; f",
      "fetch",
      "--depth",
      "1",
      `https://github.com/${repo}.git`,
      headSha,
    ],
    { ...process.env, CROFT_GITHUB_TOKEN: token },
  );
  await git(dir, ["checkout", "--quiet", "FETCH_HEAD"]);
  return dir;
}

const readFileArgs = z.object({
  path: z.string(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
});

const grepArgs = z.object({ pattern: z.string(), pathspec: z.string().optional() });

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
      schema: readFileArgs,
      async execute(args) {
        const { path, startLine, endLine } = readFileArgs.parse(args);
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
      schema: grepArgs,
      async execute(args) {
        const { pattern, pathspec } = grepArgs.parse(args);
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
