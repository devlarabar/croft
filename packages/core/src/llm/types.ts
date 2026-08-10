export type ContentPart =
  // cache: mark this part as a prompt-cache breakpoint (Anthropic dialect only;
  // ignored elsewhere). Everything up to it must be byte-stable across calls.
  | { type: "text"; text: string; cache?: true }
  | { type: "image"; mediaType: "image/jpeg" | "image/png"; dataBase64: string };

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

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
  // usage is absent when the provider reported none.
  | { type: "done"; stopReason: "end" | "tool_use" | "max_tokens"; usage?: TokenUsage };

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
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

// Seconds or an HTTP date, per the Retry-After spec.
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

// Transport/429/5xx errors only; the caller decides how many attempts.
export function isRetryableLlmError(err: unknown): boolean {
  if (err instanceof LlmTransportError) return err.status === undefined || err.status === 429 || err.status >= 500;
  return err instanceof TypeError; // fetch network failure
}
