// Dev-only ad-hoc runs: POST a URL + plan, get the local worker's NDJSON
// stream back. Login credentials go into the child's env only — never stored.
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "hono";
import { stream } from "hono/streaming";

const LOCAL_WORKER = fileURLToPath(new URL("../../worker/dist/local.js", import.meta.url));

export async function handleLocalRun(ctx: Context) {
  const body = await ctx.req.json<{
    url?: string;
    plan?: string;
    context?: string;
    login?: { username: string; password: string; loginUrl?: string };
  }>();
  if (!body.url || !body.plan) return ctx.text("url and plan are required", 400);

  const dir = await mkdtemp(join(tmpdir(), "croft-local-"));
  const planFile = join(dir, "plan.md");
  await writeFile(planFile, body.plan);
  const args = [LOCAL_WORKER, "--url", body.url, "--plan", planFile];
  if (body.context) {
    const contextFile = join(dir, "context.md");
    await writeFile(contextFile, body.context);
    args.push("--context", contextFile);
  }

  const child = spawn(process.execPath, args, {
    // Kill runs that hang — 30 min is far beyond any sane agent run.
    timeout: 30 * 60 * 1000,
    env: {
      ...process.env,
      ...(body.login
        ? {
            CROFT_LOGIN_USERNAME: body.login.username,
            CROFT_LOGIN_PASSWORD: body.login.password,
            ...(body.login.loginUrl ? { CROFT_LOGIN_URL: body.login.loginUrl } : {}),
          }
        : {}),
    },
  });
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));

  ctx.header("Content-Type", "application/x-ndjson");
  return stream(ctx, async (outStream) => {
    outStream.onAbort(() => {
      child.kill();
    });
    try {
      for await (const chunk of child.stdout) await outStream.write(chunk as Buffer);
    } finally {
      await new Promise((resolve) => child.on("close", resolve));
      await rm(dir, { recursive: true, force: true });
    }
  });
}
