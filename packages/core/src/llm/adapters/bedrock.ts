import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
  ResponseStream,
} from "@aws-sdk/client-bedrock-runtime";
import { ChatEvent, ChatRequest, Credential, LlmTransportError, ProviderAdapter } from "../types.js";
import { anthropicChatEvents, anthropicRequestBody, AnthropicStreamEvent } from "./anthropic.js";

// The credential blob is JSON, not a bare key — built by the web form.
interface BedrockCredentialBlob {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

// The SDK decodes the binary eventstream; each chunk payload is a verbatim
// Anthropic messages-API event, so the anthropic adapter's stream logic applies.
async function* chunkEvents(stream: AsyncIterable<ResponseStream>): AsyncIterable<AnthropicStreamEvent> {
  const decoder = new TextDecoder();
  for await (const frame of stream) {
    if (frame.chunk?.bytes) yield JSON.parse(decoder.decode(frame.chunk.bytes)) as AnthropicStreamEvent;
  }
}

class BedrockAdapter implements ProviderAdapter {
  id = "bedrock";
  // Cross-region inference profile IDs — the bare anthropic.* model IDs are
  // not directly invocable for these generations.
  models = [
    "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    "us.anthropic.claude-opus-4-1-20250805-v1:0",
    "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  ];

  async *chat(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent> {
    const blob = JSON.parse(await cred.getToken()) as BedrockCredentialBlob;
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
      );
      body = res.body!;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      throw new LlmTransportError(`bedrock ${status ?? "error"}: ${(err as Error).message}`, status);
    }
    yield* anthropicChatEvents(chunkEvents(body));
  }
}

export const bedrock = new BedrockAdapter();
