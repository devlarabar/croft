import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AgentTool } from "@croft/core/llm/loop";

const MAX_OUTPUT = 20_000;
const QUERY_TIMEOUT_MS = 30_000;

function appendOutput(current: string, chunk: Buffer): string {
  if (current.length > MAX_OUTPUT) return current;
  return (current + chunk.toString()).slice(0, MAX_OUTPUT + 1);
}

function queryViaSsh(host: string, keyPath: string, knownHostsPath: string, preview: string, sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      [
        "-T",
        "-i",
        keyPath,
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        `UserKnownHostsFile=${knownHostsPath}`,
        host,
        preview,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, QUERY_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) return reject(new Error("Preview Postgres query timed out after 30 seconds"));
      if (code !== 0) return reject(new Error(`Preview Postgres query exited ${code}: ${stderr.trim()}`));
      const output = stdout.trim();
      if (!output) {
        resolve("Query completed with no output.");
        return;
      }
      const suffix = output.length > MAX_OUTPUT ? "\n…(truncated)" : "";
      resolve(`${output.slice(0, MAX_OUTPUT)}${suffix}`);
    });
    child.stdin.end(sql);
  });
}

export function makePreviewPostgresTool(prNumber: number): AgentTool | null {
  const key = process.env.PREVIEW_DB_SSH_KEY;
  const host = process.env.PREVIEW_DB_SSH_HOST;
  const knownHosts = process.env.PREVIEW_DB_SSH_KNOWN_HOSTS;
  if (!key && !host && !knownHosts) return null;
  if (!key || !host || !knownHosts) {
    throw new Error("Preview Postgres access requires PREVIEW_DB_SSH_KEY, PREVIEW_DB_SSH_HOST, and PREVIEW_DB_SSH_KNOWN_HOSTS");
  }

  return {
    def: {
      name: "query_preview_postgres",
      description:
        "Run SQL against this PR preview's Postgres database. Use it to inspect or create test state needed by the test plan. The database contains synthetic preview data; queries may read or write only the current PR's database.",
      inputSchema: {
        type: "object",
        properties: {
          sql: { type: "string", description: "SQL to execute in the current PR preview database" },
        },
        required: ["sql"],
      },
    },
    schema: z.object({ sql: z.string().trim().min(1).max(20_000) }),
    async execute(args) {
      const { sql } = args as { sql: string };
      const directory = await mkdtemp(join(tmpdir(), "croft-preview-db-"));
      const keyPath = join(directory, "key");
      const knownHostsPath = join(directory, "known_hosts");
      try {
        await Promise.all([
          writeFile(keyPath, key, { mode: 0o600 }),
          writeFile(knownHostsPath, knownHosts, { mode: 0o600 }),
        ]);
        const output = await queryViaSsh(host, keyPath, knownHostsPath, `pr-${prNumber}`, sql);
        return [{ type: "text", text: output }];
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
