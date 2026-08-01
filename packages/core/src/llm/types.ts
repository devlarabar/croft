export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: "image/jpeg" | "image/png"; dataBase64: string };

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type ChatMessage =
  | { role: "user"; content: ContentPart[] }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: ContentPart[] };

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON schema
}

export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  maxTokens?: number;
}

export type ChatEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "done"; stopReason: "end" | "tool_use" | "max_tokens" };

export interface Credential {
  kind: "api_key" | "oauth";
  getToken(): Promise<string>;
}

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  // true: provider shows the code on its own callback page; user pastes it.
  codePaste?: boolean;
}

export interface ProviderAdapter {
  id: string;
  models: string[]; // all selectable models are vision-capable (test mode needs vision)
  oauth?: OAuthConfig;
  chat(req: ChatRequest, cred: Credential): AsyncIterable<ChatEvent>;
}

export class LlmTransportError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

// LLM calls retry once, transport/429 errors only.
export function isRetryableLlmError(err: unknown): boolean {
  if (err instanceof LlmTransportError) return err.status === undefined || err.status === 429 || err.status >= 500;
  return err instanceof TypeError; // fetch network failure
}
