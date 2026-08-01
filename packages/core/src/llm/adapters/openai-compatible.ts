import { sseData } from "../sse.js";
import {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  Credential,
  LlmTransportError,
  OAuthConfig,
  ProviderAdapter,
} from "../types.js";

type Json = Record<string, unknown>;

function toParts(parts: ContentPart[]): Json[] {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : { type: "image_url", image_url: { url: `data:${p.mediaType};base64,${p.dataBase64}` } },
  );
}

function toWireMessages(system: string | undefined, messages: ChatMessage[]): Json[] {
  const out: Json[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: toParts(m.content) });
    } else if (m.role === "assistant") {
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.args) },
              })),
            }
          : {}),
      });
    } else {
      // Tool messages are text-only on this dialect; image parts follow as a
      // user message so vision results still reach the model.
      const text = m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") || "(no text output)";
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: text });
      const images = m.content.filter((p) => p.type === "image");
      if (images.length) out.push({ role: "user", content: toParts(images) });
    }
  }
  return out;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  args: string;
}

// Providers sharing the OpenAI-compatible dialect share this base and differ
// only in constants.
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  constructor(
    readonly id: string,
    readonly models: string[],
    private readonly baseUrl: string,
    readonly oauth?: OAuthConfig,
  ) {}

  protected authHeaders(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}` };
  }

  async *chat(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent> {
    const token = await cred.getToken();
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders(token) },
      body: JSON.stringify({
        model: req.model,
        stream: true,
        max_completion_tokens: req.maxTokens ?? 8192,
        messages: toWireMessages(req.system, req.messages),
        ...(req.tools?.length
          ? {
              tools: req.tools.map((t) => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.inputSchema },
              })),
            }
          : {}),
      }),
    });
    if (!res.ok || !res.body) {
      throw new LlmTransportError(`${this.id} ${res.status}: ${await res.text()}`, res.status);
    }

    const calls: ToolCallAccumulator[] = [];
    let finish: string | null = null;
    for await (const data of sseData(res.body)) {
      if (data === "[DONE]") break;
      const chunk = JSON.parse(data) as {
        choices?: {
          delta?: {
            content?: string;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
          };
          finish_reason?: string | null;
        }[];
      };
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.delta?.content) yield { type: "text_delta", text: choice.delta.content };
      for (const tc of choice.delta?.tool_calls ?? []) {
        calls[tc.index] ??= { id: "", name: "", args: "" };
        if (tc.id) calls[tc.index]!.id = tc.id;
        if (tc.function?.name) calls[tc.index]!.name += tc.function.name;
        if (tc.function?.arguments) calls[tc.index]!.args += tc.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    for (const c of calls) {
      yield { type: "tool_call", call: { id: c.id, name: c.name, args: c.args ? JSON.parse(c.args) : {} } };
    }
    yield {
      type: "done",
      stopReason: calls.length ? "tool_use" : finish === "length" ? "max_tokens" : "end",
    };
  }
}
