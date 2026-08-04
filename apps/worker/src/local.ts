// Ad-hoc run child process, spawned by the web app's /api/local-runs route:
// tests a URL against a supplied plan using croft's configured active model.
// No run row, no object storage, no GitHub — events stream to stdout as
// NDJSON, artifacts go to a tmp dir, login creds arrive via env only.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getConfig } from "@croft/core/config";
import { loadCredential } from "@croft/core/llm/credential";
import { getProvider } from "@croft/core/llm/registry";
import { executeTestRun } from "./testrun.js";

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      plan: { type: "string" },
      context: { type: "string" },
    },
  });
  const { url, plan: planFile, context: contextFile } = values;
  if (!url || !planFile) throw new Error("--url and --plan are required");

  const cfg = await getConfig();
  if (!cfg.activeModel) throw new Error("croft has no active model configured — set one in the dashboard");
  const adapter = getProvider(cfg.activeModel.providerId);
  const cred = await loadCredential(cfg.activeModel.credentialId, adapter.oauth);

  const plan = await readFile(planFile, "utf8");
  const repoContext = contextFile ? await readFile(contextFile, "utf8") : null;

  const username = process.env.CROFT_LOGIN_USERNAME;
  const logins = username
    ? [
        {
          username,
          password: process.env.CROFT_LOGIN_PASSWORD ?? "",
          loginUrl: process.env.CROFT_LOGIN_URL,
        },
      ]
    : [];

  const runId = randomUUID();
  const outDir = join(tmpdir(), `croft-${runId}`);
  await mkdir(outDir, { recursive: true });
  process.env.ARTIFACTS_DIR = outDir;

  const emit = async (type: string, payload: unknown) => {
    process.stdout.write(`${JSON.stringify({ type, payload })}\n`);
  };
  // Keys look like "<runId>/01-name.png" — flatten to a file in outDir.
  const saveArtifact = async (key: string, body: Buffer) => {
    const path = join(outDir, key.split("/").pop()!);
    await writeFile(path, body);
    return path;
  };

  const { status, report, screenshots } = await executeTestRun({
    runId,
    previewUrl: url,
    plan,
    logins,
    repoContext,
    adapter,
    cred,
    model: cfg.activeModel.model,
    toolCallCap: cfg.toolCallCap,
    emit,
    saveArtifact,
  });

  await emit("result", { status, report, screenshots, artifactsDir: outDir });
  // Not process.exit(): piped stdout flushes async and exiting can truncate output.
  process.exitCode = status === "passed" ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.stdout.write(`${JSON.stringify({ type: "error", payload: { message: String((err as Error).stack ?? err) } })}\n`);
  process.exitCode = 2;
});
