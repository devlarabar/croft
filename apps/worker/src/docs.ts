import { z } from "zod";
import type { AgentTool } from "@croft/core/llm/loop";

const MAX_DOC_CHARS = 20_000;

function toText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Public documentation only: https, no credentials sent, no private hosts —
// the agent reads the PR's own code, so a fetch target can be injected.
export const docsTool: AgentTool = {
  def: {
    name: "fetch_docs",
    description:
      "Fetch a public documentation page over HTTPS and return it as text. Use it to verify an implementation against the official docs of a third-party service or package (Clerk, AWS, an npm package's README, etc.).",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  schema: z.object({ url: z.string() }),
  async execute(args) {
    const { url } = args as { url: string };
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return [{ type: "text", text: `Refused: ${parsed.protocol} — only https documentation URLs are allowed.` }];
    }
    if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) {
      return [{ type: "text", text: `Refused: ${parsed.hostname} is a private address.` }];
    }
    const res = await fetch(parsed, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    const text = res.headers.get("content-type")?.includes("html") ? toText(body) : body;
    return [{ type: "text", text: `HTTP ${res.status}\n${text.slice(0, MAX_DOC_CHARS)}` }];
  },
};
