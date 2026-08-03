import { z } from "zod";
import type { AgentTool } from "@croft/core/llm/loop";

// Test-setup requests only. Scoped to the preview's parent domain (the API
// often lives on a sibling subdomain, e.g. api.1431.preview.example.com) so a
// prompt-injected page can't make the agent call arbitrary hosts.
export function makeHttpTool(previewUrl: string): AgentTool {
  const previewHost = new URL(previewUrl).hostname;
  const parentDomain = previewHost.split(".").slice(1).join(".");
  return {
    def: {
      name: "http_request",
      description:
        "Send an HTTP request to the preview deployment (or a sibling subdomain). Use it to satisfy test-plan prerequisites when the repository context documents endpoints for that, e.g. seeding or mutating test data. Returns the status and response body.",
      inputSchema: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
          url: { type: "string" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { type: "string", description: "Raw request body, e.g. a JSON string" },
        },
        required: ["method", "url"],
      },
    },
    schema: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
      url: z.string(),
      headers: z.record(z.string(), z.string()).optional(),
      body: z.string().optional(),
    }),
    async execute(args) {
      const { method, url, headers, body } = args as {
        method: string;
        url: string;
        headers?: Record<string, string>;
        body?: string;
      };
      const host = new URL(url).hostname;
      if (host !== previewHost && !host.endsWith(`.${parentDomain}`)) {
        return [
          {
            type: "text",
            text: `Refused: ${host} is outside the preview deployment's domain (${previewHost}).`,
          },
        ];
      }
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(15_000),
      });
      const text = (await res.text()).slice(0, 4000);
      return [{ type: "text", text: `HTTP ${res.status}\n${text}` }];
    },
  };
}
