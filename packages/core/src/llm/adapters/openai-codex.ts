import { z } from "zod";
import { sseData } from "../sse.js";
import {
  type ChatEvent,
  type ChatMessage,
  type ChatRequest,
  type ContentPart,
  type Credential,
  LlmTransportError,
  parseRetryAfter,
} from "../types.js";

const claimsSchema = z.object({
  "https://api.openai.com/auth": z.object({ chatgpt_account_id: z.string().min(1) }),
});
const eventSchema = z.object({ type: z.string() });
const deltaSchema = z.object({ delta: z.string() });
const functionCallSchema = z.object({ call_id: z.string(), name: z.string(), arguments: z.string() });
const completionSchema = z.object({
  response: z.object({
    output: z.array(z.looseObject({ type: z.string() })),
    incomplete_details: z.object({ reason: z.string() }).nullish(),
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      input_tokens_details: z.object({ cached_tokens: z.number() }).optional(),
    }).optional(),
  }),
});

type InputItem = Record<string, unknown>;

function toInputParts(parts: ContentPart[]): InputItem[] {
  return parts.map((part) => part.type === "text"
    ? { type: "input_text", text: part.text }
    : { type: "input_image", image_url: `data:${part.mediaType};base64,${part.dataBase64}`, detail: "auto" });
}

function toInput(messages: ChatMessage[]): InputItem[] {
  const input: InputItem[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      input.push({ role: "user", content: toInputParts(message.content) });
    } else if (message.role === "assistant") {
      if (message.content) input.push({ role: "assistant", content: [{ type: "output_text", text: message.content }] });
      for (const call of message.toolCalls ?? []) {
        input.push({ type: "function_call", call_id: call.id, name: call.name, arguments: JSON.stringify(call.args) });
      }
    } else {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
      });
      const images = message.content.filter((part) => part.type === "image");
      if (images.length) input.push({ role: "user", content: toInputParts(images) });
    }
  }
  return input;
}

export async function* codexChat(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent> {
  const token = await cred.getToken();
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid ChatGPT credential. Reconnect OpenAI from Models.");
  const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
  const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${token}`,
      "chatgpt-account-id": claims["https://api.openai.com/auth"].chatgpt_account_id,
      "OpenAI-Beta": "responses=experimental",
      originator: "codex_cli_rs",
    },
    // Codex requires instructions and store:false, and rejects max_output_tokens.
    body: JSON.stringify({
      model: req.model,
      instructions: req.system ?? "",
      input: toInput(req.messages),
      stream: true,
      store: false,
      tools: req.tools?.map((tool) => ({
        type: "function", name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false,
      })) ?? [],
      tool_choice: req.toolChoice ? { type: "function", name: req.toolChoice } : "auto",
    }),
    signal: req.signal,
  }).catch((error: Error) => {
    if (req.signal?.aborted) throw error;
    throw new LlmTransportError("OpenAI Codex request failed. Please retry.");
  });
  if (!res.ok || !res.body) {
    throw new LlmTransportError(
      `OpenAI Codex returned ${res.status}. Check the selected model and your ChatGPT plan, or reconnect from Models.`,
      res.status,
      parseRetryAfter(res.headers.get("retry-after")),
    );
  }
  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") break;
    const json: unknown = JSON.parse(data);
    const event = eventSchema.parse(json);
    if (event.type === "response.output_text.delta") {
      yield { type: "text_delta", text: deltaSchema.parse(json).delta };
    } else if (event.type === "response.completed" || event.type === "response.incomplete") {
      const { response } = completionSchema.parse(json);
      if (event.type === "response.incomplete" && response.incomplete_details?.reason !== "max_output_tokens") {
        throw new LlmTransportError("OpenAI Codex could not complete the response. Please retry.");
      }
      const calls = response.output
        .filter((item) => event.type === "response.completed" && item.type === "function_call")
        .map((item) => functionCallSchema.parse(item));
      for (const call of calls) {
        yield { type: "tool_call", call: { id: call.call_id, name: call.name, args: JSON.parse(call.arguments) } };
      }
      let stopReason: "end" | "tool_use" | "max_tokens" = calls.length ? "tool_use" : "end";
      if (event.type === "response.incomplete") stopReason = "max_tokens";
      yield {
        type: "done",
        stopReason,
        ...(response.usage ? { usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        } } : {}),
      };
      return;
    } else if (event.type === "response.failed" || event.type === "error") {
      throw new LlmTransportError("OpenAI Codex could not complete the response. Check your ChatGPT access and retry.");
    }
  }
  throw new LlmTransportError("OpenAI Codex stream ended before completion. Please retry.");
}
