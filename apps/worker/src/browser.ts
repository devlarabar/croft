import { readFile, readdir, unlink } from "node:fs/promises";
import { chromium } from "playwright";
import { z } from "zod";
import { uploadArtifact } from "@croft/core/s3";
import type { AgentTool } from "@croft/core/llm/loop";

// gVisor: /tmp is memory-backed and counts against the job's 2 GB — record to
// the image's own filesystem instead.
const ARTIFACTS_DIR = process.env.ARTIFACTS_DIR ?? "/artifacts";

export interface Screenshot {
  name: string;
  url: string;
}

export async function openBrowserSession(runId: string) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    // Headless Chromium's default UA contains "HeadlessChrome", which trips
    // posthog-js's bot filter — feature flags never load and apps render
    // their no-flags fallback. Present a normal Chrome UA instead.
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    // Can't be toggled mid-session: Playwright only finalizes the file when
    // the context closes.
    recordVideo: { dir: ARTIFACTS_DIR, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const screenshots: Screenshot[] = [];

  const tools: AgentTool[] = [
    {
      def: {
        name: "browser_navigate",
        description: "Navigate the browser to a URL.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
      schema: z.object({ url: z.string() }),
      async execute(args) {
        const { url } = args as { url: string };
        await page.goto(url, { waitUntil: "load", timeout: 30_000 });
        return [{ type: "text", text: `Navigated to ${page.url()} — title: ${await page.title()}` }];
      },
    },
    {
      def: {
        name: "browser_click",
        description:
          "Click an element. Give a CSS selector, or text= / role= Playwright selector visible on the page.",
        inputSchema: {
          type: "object",
          properties: { selector: { type: "string" } },
          required: ["selector"],
        },
      },
      schema: z.object({ selector: z.string() }),
      async execute(args) {
        const { selector } = args as { selector: string };
        await page.click(selector, { timeout: 10_000 });
        return [{ type: "text", text: `Clicked ${selector}. Current URL: ${page.url()}` }];
      },
    },
    {
      def: {
        name: "browser_type",
        description: "Fill an input matched by a selector with text.",
        inputSchema: {
          type: "object",
          properties: { selector: { type: "string" }, text: { type: "string" } },
          required: ["selector", "text"],
        },
      },
      schema: z.object({ selector: z.string(), text: z.string() }),
      async execute(args) {
        const { selector, text } = args as { selector: string; text: string };
        await page.fill(selector, text, { timeout: 10_000 });
        return [{ type: "text", text: `Typed into ${selector}` }];
      },
    },
    {
      def: {
        name: "browser_screenshot",
        description:
          "Take a screenshot of the current page. Returns the image and its public URL for the report.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", description: "short kebab-case name" } },
          required: ["name"],
        },
      },
      schema: z.object({ name: z.string().regex(/^[a-z0-9-]+$/) }),
      async execute(args) {
        const name = `${String(screenshots.length + 1).padStart(2, "0")}-${(args as { name: string }).name}`;
        // Full-resolution PNG to Object Storage for the report...
        const png = await page.screenshot({ type: "png" });
        const url = await uploadArtifact(`${runId}/${name}.png`, png, "image/png");
        screenshots.push({ name, url });
        // ...JPEG to the model — vision tokens are the dominant per-run cost.
        const jpeg = await page.screenshot({ type: "jpeg", quality: 50 });
        return [
          { type: "text", text: `Screenshot saved: ${url}` },
          { type: "image", mediaType: "image/jpeg", dataBase64: jpeg.toString("base64") },
        ];
      },
    },
  ];

  return {
    tools,
    screenshots,
    // Returns the public URL of the uploaded video, if one was produced.
    async close(): Promise<string | null> {
      await context.close();
      await browser.close();
      const webm = (await readdir(ARTIFACTS_DIR)).find((f) => f.endsWith(".webm"));
      if (!webm) return null;
      const path = `${ARTIFACTS_DIR}/${webm}`;
      const url = await uploadArtifact(`${runId}/run.webm`, await readFile(path), "video/webm");
      await unlink(path);
      return url;
    },
  };
}
