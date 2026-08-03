import { sseData } from "../sse.js";
import {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  Credential,
  LlmTransportError,
  OAuthConfig,
  parseRetryAfter,
  ProviderAdapter,
} from "../types.js";

type Json = Record<string, unknown>;

function toParts(parts: ContentPart[]): Json[] {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "image_url", image_url: { url: `data:${part.mediaType};base64,${part.dataBase64}` } },
  );
}

function toWireMessages(system: string | undefined, messages: ChatMessage[]): Json[] {
  const out: Json[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: toParts(message.content) });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      });
    } else {
      // Tool messages are text-only on this dialect; image parts follow as a
      // user message so vision results still reach the model.
      const text =
        message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") ||
        "(no text output)";
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: text });
      const images = message.content.filter((part) => part.type === "image");
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
              tools: req.tools.map((tool) => ({
                type: "function",
                function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
              })),
            }
          : {}),
      }),
    });
    if (!res.ok || !res.body) {
      throw new LlmTransportError(
        `${this.id} ${res.status}: ${await res.text()}`,
        res.status,
        parseRetryAfter(res.headers.get("retry-after")),
      );
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
      for (const toolCall of choice.delta?.tool_calls ?? []) {
        calls[toolCall.index] ??= { id: "", name: "", args: "" };
        if (toolCall.id) calls[toolCall.index]!.id = toolCall.id;
        if (toolCall.function?.name) calls[toolCall.index]!.name += toolCall.function.name;
        if (toolCall.function?.arguments) calls[toolCall.index]!.args += toolCall.function.arguments;
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }

    for (const call of calls) {
      yield { type: "tool_call", call: { id: call.id, name: call.name, args: call.args ? JSON.parse(call.args) : {} } };
    }
    yield {
      type: "done",
      stopReason: calls.length ? "tool_use" : finish === "length" ? "max_tokens" : "end",
    };
  }
}
