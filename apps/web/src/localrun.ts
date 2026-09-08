import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";

const localRunSchema = z.object({
  url: z.string().optional(),
  plan: z.string().optional(),
  context: z.string().optional(),
  login: z.object({ username: z.string(), password: z.string(), loginUrl: z.string().optional() }).optional(),
});

export async function handleLocalRun(request: Request): Promise<Response> {
  const body = localRunSchema.parse(await request.json());
  if (!body.url || !body.plan) return new Response("url and plan are required", { status: 400 });

  const dir = await mkdtemp(join(tmpdir(), "croft-local-"));
  const planFile = join(dir, "plan.md");
  await writeFile(planFile, body.plan);
  const args = [resolve(process.cwd(), "../worker/dist/local.js"), "--url", body.url, "--plan", planFile];
  if (body.context) {
    const contextFile = join(dir, "context.md");
    await writeFile(contextFile, body.context);
    args.push("--context", contextFile);
  }

  const child = spawn(process.execPath, args, {
    timeout: 30 * 60 * 1000,
    env: {
      ...process.env,
      ...(body.login ? {
        CROFT_LOGIN_USERNAME: body.login.username,
        CROFT_LOGIN_PASSWORD: body.login.password,
        ...(body.login.loginUrl ? { CROFT_LOGIN_URL: body.login.loginUrl } : {}),
      } : {}),
    },
  });
  child.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  const stop = () => { child.kill(); };
  request.signal.addEventListener("abort", stop, { once: true });
  if (request.signal.aborted) stop();
  const cleanup = new Promise<void>((done) => child.once("close", () => {
    request.signal.removeEventListener("abort", stop);
    done();
  })).then(() => rm(dir, { recursive: true, force: true }));
  const output = child.stdout[Symbol.asyncIterator]();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      child.once("error", (error) => controller.error(error));
    },
    async pull(controller) {
      const { done, value } = await output.next();
      if (done) {
        await cleanup;
        controller.close();
      } else {
        controller.enqueue(z.instanceof(Buffer).parse(value));
      }
    },
    async cancel() {
      stop();
      await cleanup;
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
}
