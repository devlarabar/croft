import { createHash } from "node:crypto";
import { sseData } from "../sse.js";
import {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  Credential,
  LlmTransportError,
  ProviderAdapter,
} from "../types.js";

type Json = Record<string, unknown>;

// Mirrors Claude Code's x-anthropic-billing-header so Anthropic classifies
// OAuth traffic as first-party Claude Code usage instead of rejecting it with
// a misleading "out of extra usage" 400. Values must match the current Claude
// Code release (see gotgenes/pi-anthropic-auth).
const CLAUDE_CODE_VERSION = "2.1.206";
const BILLING_HEADER_SALT = "59cf53e54c78";
const BILLING_HEADER_POSITIONS = [4, 7, 20];

function billingHeader(messages: ChatMessage[]): string | undefined {
  const first = messages.find((m) => m.role === "user");
  const part = first?.role === "user" ? first.content.find((p) => p.type === "text") : undefined;
  const text = part?.type === "text" ? part.text : "";
  if (!text) return undefined;
  const cch = createHash("sha256").update(text).digest("hex").slice(0, 5);
  const sampled = BILLING_HEADER_POSITIONS.map((i) => text[i] || "0").join("");
  const suffix = createHash("sha256")
    .update(`${BILLING_HEADER_SALT}${sampled}${CLAUDE_CODE_VERSION}`)
    .digest("hex")
    .slice(0, 3);
  return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${suffix}; cc_entrypoint=sdk-cli; cch=${cch};`;
}

function toParts(parts: ContentPart[]): Json[] {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image", source: { type: "base64", media_type: p.mediaType, data: p.dataBase64 } },
  );
}

function toWireMessages(messages: ChatMessage[]): Json[] {
  const out: Json[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: toParts(m.content) });
    } else if (m.role === "assistant") {
      const content: Json[] = m.content ? [{ type: "text", text: m.content }] : [];
      for (const c of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      }
      out.push({ role: "assistant", content });
    } else {
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: toParts(m.content) }],
      });
    }
  }
  return out;
}

class AnthropicAdapter implements ProviderAdapter {
  id = "anthropic";
  models = ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"];
  // The Claude Code public client and Anthropic's own code-display callback
  // page — no client registration needed.
  oauth = {
    authorizeUrl: "https://claude.ai/oauth/authorize",
    tokenUrl: "https://console.anthropic.com/v1/oauth/token",
    clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    scopes: ["org:create_api_key", "user:profile", "user:inference"],
    redirectUri: "https://console.anthropic.com/oauth/code/callback",
    codePaste: true,
  };

  async *chat(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent> {
    const token = await cred.getToken();
    const auth: Record<string, string> =
      cred.kind === "oauth"
        ? { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" }
        : { "x-api-key": token };
    let system: string | Json[] | undefined = req.system;
    if (cred.kind === "oauth") {
      const header = billingHeader(req.messages);
      if (header) {
        system = [
          { type: "text", text: header },
          ...(req.system ? [{ type: "text", text: req.system }] : []),
        ];
      }
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...auth },
      body: JSON.stringify({
        model: req.model,
        stream: true,
        max_tokens: req.maxTokens ?? 8192,
        ...(system ? { system } : {}),
        messages: toWireMessages(req.messages),
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema,
              })),
            }
          : {}),
      }),
    });
    if (!res.ok || !res.body) {
      throw new LlmTransportError(`anthropic ${res.status}: ${await res.text()}`, res.status);
    }

    let block: { id: string; name: string; json: string } | null = null;
    let stopReason: string | null = null;
    for await (const data of sseData(res.body)) {
      const ev = JSON.parse(data) as {
        type: string;
        content_block?: { type: string; id?: string; name?: string };
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
      };
      switch (ev.type) {
        case "content_block_start":
          if (ev.content_block?.type === "tool_use") {
            block = { id: ev.content_block.id!, name: ev.content_block.name!, json: "" };
          }
          break;
        case "content_block_delta":
          if (ev.delta?.type === "text_delta" && ev.delta.text) {
            yield { type: "text_delta", text: ev.delta.text };
          } else if (ev.delta?.type === "input_json_delta" && block) {
            block.json += ev.delta.partial_json ?? "";
          }
          break;
        case "content_block_stop":
          if (block) {
            yield {
              type: "tool_call",
              call: { id: block.id, name: block.name, args: block.json ? JSON.parse(block.json) : {} },
            };
            block = null;
          }
          break;
        case "message_delta":
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
          break;
      }
    }
    yield {
      type: "done",
      stopReason: stopReason === "tool_use" ? "tool_use" : stopReason === "max_tokens" ? "max_tokens" : "end",
    };
  }
}

export const anthropic = new AnthropicAdapter();
