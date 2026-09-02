import { createBedrockMantle } from "@ai-sdk/amazon-bedrock/mantle";
import {
  APICallError,
  type LanguageModelV3FilePart,
  type LanguageModelV3FinishReason,
  type LanguageModelV3FunctionTool,
  type LanguageModelV3Prompt,
  type LanguageModelV3TextPart,
} from "@ai-sdk/provider";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
  ResponseStream,
} from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import {
  ChatEvent,
  ChatMessage,
  ChatRequest,
  ContentPart,
  Credential,
  LlmTransportError,
  parseRetryAfter,
  ProviderAdapter,
} from "../types.js";
import { anthropicChatEvents, anthropicRequestBody, AnthropicStreamEvent } from "./anthropic.js";

const GPT_REGION = "us-east-1";
const GPT_MODELS = ["openai.gpt-5.6-sol", "openai.gpt-5.6-terra", "openai.gpt-5.6-luna"];

// The credential blob is JSON, not a bare key — built by the web form.
const bedrockCredentialSchema = z.object({
  accessKeyId: z.string().min(1),
  secretAccessKey: z.string().min(1),
  region: z.string().min(1),
});

function parseCredential(token: string) {
  return bedrockCredentialSchema.parse(JSON.parse(token));
}

// The SDK decodes the binary eventstream; each chunk payload is a verbatim
// Anthropic messages-API event, so the anthropic adapter's stream logic applies.
async function* chunkEvents(stream: AsyncIterable<ResponseStream>): AsyncIterable<AnthropicStreamEvent> {
  const decoder = new TextDecoder();
  for await (const frame of stream) {
    if (frame.chunk?.bytes) yield JSON.parse(decoder.decode(frame.chunk.bytes)) as AnthropicStreamEvent;
  }
}

function toAiParts(parts: ContentPart[]): Array<LanguageModelV3TextPart | LanguageModelV3FilePart> {
  return parts.map((part) =>
    part.type === "text"
      ? { type: "text", text: part.text }
      : { type: "file", data: part.dataBase64, mediaType: part.mediaType },
  );
}

function toAiPrompt(system: string | undefined, messages: ChatMessage[]): LanguageModelV3Prompt {
  const prompt: LanguageModelV3Prompt = system ? [{ role: "system", content: system }] : [];
  const toolNames = new Map(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? (message.toolCalls ?? []).map((call) => [call.id, call.name] as const)
        : [],
    ),
  );
  for (const message of messages) {
    if (message.role === "user") {
      prompt.push({ role: "user", content: toAiParts(message.content) });
    } else if (message.role === "assistant") {
      prompt.push({
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text" as const, text: message.content }] : []),
          ...(message.toolCalls ?? []).map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.name,
            input: call.args,
          })),
        ],
      });
    } else {
      const toolName = toolNames.get(message.toolCallId);
      if (!toolName) throw new Error(`tool name not found for call ${message.toolCallId}`);
      prompt.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: message.toolCallId,
            toolName,
            output: {
              type: "content",
              value: message.content.map((part) =>
                part.type === "text"
                  ? { type: "text", text: part.text }
                  : { type: "file-data", data: part.dataBase64, mediaType: part.mediaType },
              ),
            },
          },
        ],
      });
    }
  }
  return prompt;
}

function transportError(error: unknown): Error {
  if (!APICallError.isInstance(error)) return error instanceof Error ? error : new Error(String(error));
  return new LlmTransportError(
    `bedrock ${error.statusCode ?? "error"}: ${error.message}`,
    error.statusCode,
    parseRetryAfter(error.responseHeaders?.["retry-after"] ?? null),
  );
}

function stopReason(reason: LanguageModelV3FinishReason["unified"]): "end" | "tool_use" | "max_tokens" {
  if (reason === "tool-calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end";
}

async function* chatGpt(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent> {
  const blob = parseCredential(await cred.getToken());
  const model = createBedrockMantle({
    region: GPT_REGION,
    baseURL: `https://bedrock-mantle.${GPT_REGION}.api.aws/openai/v1`,
    credentialProvider: async () => ({
      accessKeyId: blob.accessKeyId,
      secretAccessKey: blob.secretAccessKey,
    }),
  }).responses(req.model);
  const tools: LanguageModelV3FunctionTool[] | undefined = req.tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  let result;
  try {
    result = await model.doStream({
      prompt: toAiPrompt(req.system, req.messages),
      maxOutputTokens: req.maxTokens ?? 8192,
      tools,
      abortSignal: req.signal,
      providerOptions: {
        openai: { store: false, forceReasoning: true, reasoningEffort: "high" },
      },
    });
  } catch (error) {
    throw transportError(error);
  }
  for await (const part of result.stream) {
    if (part.type === "text-delta") {
      yield { type: "text_delta", text: part.delta };
    } else if (part.type === "tool-call") {
      yield {
        type: "tool_call",
        call: { id: part.toolCallId, name: part.toolName, args: JSON.parse(part.input) },
      };
    } else if (part.type === "error") {
      throw transportError(part.error);
    } else if (part.type === "finish") {
      yield {
        type: "done",
        stopReason: stopReason(part.finishReason.unified),
        usage: {
          inputTokens: part.usage.inputTokens.total ?? 0,
          outputTokens: part.usage.outputTokens.total ?? 0,
          cacheReadTokens: part.usage.inputTokens.cacheRead ?? 0,
          cacheWriteTokens: part.usage.inputTokens.cacheWrite ?? 0,
        },
      };
      return;
    }
  }
  yield { type: "done", stopReason: "end" };
}

class BedrockAdapter implements ProviderAdapter {
  id = "bedrock";
  models = [
    "eu.anthropic.claude-sonnet-5",
    "eu.anthropic.claude-opus-5",
    "eu.anthropic.claude-sonnet-4-6",
    "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    ...GPT_MODELS,
  ];

  async *chat(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent> {
    if (GPT_MODELS.includes(req.model)) {
      yield* chatGpt(req, cred);
      return;
    }

    const blob = parseCredential(await cred.getToken());
    const client = new BedrockRuntimeClient({
      region: blob.region,
      credentials: { accessKeyId: blob.accessKeyId, secretAccessKey: blob.secretAccessKey },
    });
    let body: AsyncIterable<ResponseStream>;
    try {
      const res = await client.send(
        new InvokeModelWithResponseStreamCommand({
          modelId: req.model,
          contentType: "application/json",
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            ...anthropicRequestBody(req, req.system),
          }),
        }),
        { abortSignal: req.signal },
      );
      body = res.body!;
    } catch (err) {
      if (req.signal?.aborted) throw err;
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      throw new LlmTransportError(`bedrock ${status ?? "error"}: ${(err as Error).message}`, status);
    }
    yield* anthropicChatEvents(chunkEvents(body));
  }
}

export const bedrock = new BedrockAdapter();
