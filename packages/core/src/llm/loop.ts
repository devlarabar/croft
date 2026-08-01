import type { ZodType } from "zod";
import { withRetry } from "../retry.js";
import {
  ChatMessage,
  ChatRequest,
  ContentPart,
  Credential,
  ProviderAdapter,
  ToolCall,
  ToolDef,
  isRetryableLlmError,
} from "./types.js";

export interface AgentTool {
  def: ToolDef;
  schema: ZodType;
  execute(args: unknown): Promise<ContentPart[]>;
}

interface Turn {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end" | "tool_use" | "max_tokens";
}

async function chatTurn(adapter: ProviderAdapter, req: ChatRequest, cred: Credential): Promise<Turn> {
  return withRetry(
    async () => {
      const turn: Turn = { text: "", toolCalls: [], stopReason: "end" };
      for await (const ev of adapter.chat(req, cred)) {
        if (ev.type === "text_delta") turn.text += ev.text;
        else if (ev.type === "tool_call") turn.toolCalls.push(ev.call);
        else turn.stopReason = ev.stopReason;
      }
      return turn;
    },
    { attempts: 2, shouldRetry: isRetryableLlmError },
  );
}

export interface AgentLoopOptions {
  adapter: ProviderAdapter;
  cred: Credential;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: AgentTool[];
  toolCallCap?: number;
  onEvent(type: string, payload: unknown): Promise<void>;
}

// While the response has tool calls: execute, append results, re-send —
// with a hard cap on tool calls per run (the real cost bound).
export async function runAgentLoop(
  opts: AgentLoopOptions,
): Promise<{ outcome: "done" | "cap_hit"; messages: ChatMessage[] }> {
  const cap = opts.toolCallCap ?? 50;
  const messages = [...opts.messages];
  const byName = new Map(opts.tools.map((t) => [t.def.name, t]));
  let toolCalls = 0;

  while (true) {
    const turn = await chatTurn(
      opts.adapter,
      { model: opts.model, system: opts.system, messages, tools: opts.tools.map((t) => t.def) },
      opts.cred,
    );
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
    if (turn.text) await opts.onEvent("assistant_text", { text: turn.text });
    if (turn.toolCalls.length === 0) return { outcome: "done", messages };

    let capHit = false;
    for (const call of turn.toolCalls) {
      if (capHit || toolCalls >= cap) {
        // Every tool call needs a result message or the next request is invalid.
        capHit = true;
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: [{ type: "text", text: "Not executed: tool-call budget cap reached." }],
        });
        continue;
      }
      toolCalls++;
      await opts.onEvent("tool_call", { name: call.name, args: call.args });
      const result = await executeTool(byName.get(call.name), call);
      await opts.onEvent("tool_result", {
        name: call.name,
        result: result.filter((p) => p.type === "text"),
      });
      messages.push({ role: "tool", toolCallId: call.id, content: result });
    }
    if (capHit) return { outcome: "cap_hit", messages };
  }
}

async function executeTool(tool: AgentTool | undefined, call: ToolCall): Promise<ContentPart[]> {
  if (!tool) return [{ type: "text", text: `Unknown tool: ${call.name}` }];
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) return [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }];
  try {
    return await tool.execute(parsed.data);
  } catch (err) {
    // Browser actions never auto-retry: the model sees the failure and decides.
    return [{ type: "text", text: `Tool failed: ${(err as Error).message}` }];
  }
}

// One-shot, no tools: Q&A mode and test-plan generation.
export async function complete(
  adapter: ProviderAdapter,
  cred: Credential,
  model: string,
  system: string,
  prompt: string,
): Promise<string> {
  const turn = await chatTurn(
    adapter,
    { model, system, messages: [{ role: "user", content: [{ type: "text", text: prompt }] }] },
    cred,
  );
  return turn.text;
}
