import type { ZodType } from "zod";
import { redact } from "../redact.js";
import { withRetry } from "../retry.js";
import {
  ChatMessage,
  ChatRequest,
  ContentPart,
  Credential,
  LlmTransportError,
  ProviderAdapter,
  TokenUsage,
  ToolCall,
  ToolDef,
  isRetryableLlmError,
} from "./types.js";

export interface AgentTool {
  def: ToolDef;
  schema: ZodType;
  recoveryTool?: string;
  execute(args: unknown): Promise<ContentPart[]>;
}

interface Turn {
  text: string;
  toolCalls: ToolCall[];
  stopReason: "end" | "tool_use" | "max_tokens";
  usage?: TokenUsage;
}

const MAX_LLM_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 30_000;

// Rate limits are routine on long agent runs: back off exponentially,
// honoring the provider's Retry-After when it sends one.
function llmRetryDelayMs(err: unknown, attempt: number): number {
  const retryAfterMs = err instanceof LlmTransportError ? err.retryAfterMs : undefined;
  return Math.min(retryAfterMs ?? 1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

async function chatTurn(adapter: ProviderAdapter, req: ChatRequest, cred: Credential): Promise<Turn> {
  return withRetry(
    async () => {
      const turn: Turn = { text: "", toolCalls: [], stopReason: "end" };
      for await (const ev of adapter.chat(req, cred)) {
        if (ev.type === "text_delta") turn.text += ev.text;
        else if (ev.type === "tool_call") turn.toolCalls.push(ev.call);
        else {
          turn.stopReason = ev.stopReason;
          turn.usage = ev.usage;
        }
      }
      return turn;
    },
    { attempts: MAX_LLM_ATTEMPTS, shouldRetry: isRetryableLlmError, delayMs: llmRetryDelayMs },
  );
}

export interface AgentLoopOptions {
  adapter: ProviderAdapter;
  cred: Credential;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: AgentTool[];
  completionTool: string;
  toolChoice?: string;
  toolCallCap?: number;
  deadlineAt?: number;
  onEvent(type: string, payload: unknown): Promise<void>;
}

// While the response has tool calls: execute, append results, re-send —
// with a hard cap on tool calls per run (the real cost bound).
interface AgentLoopResult {
  outcome: "done" | "incomplete" | "cap_hit" | "deadline_hit";
  messages: ChatMessage[];
  toolCalls: number;
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const cap = opts.toolCallCap ?? 50;
  const messages = [...opts.messages];
  const byName = new Map(opts.tools.map((tool) => [tool.def.name, tool]));
  let toolCalls = 0;
  let forcedTurns = 0;
  let incompleteTurns = 0;
  let recoveryTool: string | undefined;

  async function finish(outcome: AgentLoopResult["outcome"]): Promise<AgentLoopResult> {
    await opts.onEvent("agent_loop_stopped", { outcome, toolCalls, incompleteTurns, recoveryTool });
    return { outcome, messages, toolCalls };
  }

  await opts.onEvent("agent_loop_started", {
    completionTool: opts.completionTool, toolChoice: opts.toolChoice,
    tools: [...byName.keys()], toolCallCap: cap, deadlineAt: opts.deadlineAt,
  });
  while (true) {
    if (opts.toolChoice && forcedTurns++ >= 3) return finish("incomplete");
    if (toolCalls >= cap) return finish("cap_hit");
    if (opts.deadlineAt && Date.now() >= opts.deadlineAt) return finish("deadline_hit");
    const signal = opts.deadlineAt ? AbortSignal.timeout(Math.max(1, opts.deadlineAt - Date.now())) : undefined;
    let turn: Turn;
    try {
      turn = await chatTurn(
        opts.adapter,
        {
          model: opts.model,
          system: opts.system,
          messages,
          tools: opts.tools.map((tool) => tool.def),
          toolChoice: recoveryTool ?? opts.toolChoice,
          signal,
        },
        opts.cred,
      );
    } catch (err) {
      if (signal?.aborted) return finish("deadline_hit");
      await opts.onEvent("agent_loop_error", { stage: "model", toolCalls });
      throw err;
    }
    messages.push({ role: "assistant", content: turn.text, toolCalls: turn.toolCalls });
    if (turn.usage) await opts.onEvent("usage", turn.usage);
    if (turn.text) await opts.onEvent("assistant_text", { text: turn.text });
    if (turn.toolCalls.length === 0) {
      if (!opts.toolChoice && ++incompleteTurns >= 3) return finish("incomplete");
      let instruction = `Call \`${opts.completionTool}\` now to submit your result.`;
      if (!opts.toolChoice) instruction = "Your tools are still available. Continue from the current state, attempt the remaining work, then submit your result. A tool error does not mean tools were removed.";
      if (recoveryTool) instruction = `The last action failed, but your tools are still available. Call \`${recoveryTool}\` to inspect the current state before deciding how to continue.`;
      await opts.onEvent("agent_continuation", { attempt: incompleteTurns, recoveryTool, forced: Boolean(opts.toolChoice) });
      messages.push({ role: "user", content: [{ type: "text", text: instruction }] });
      continue;
    }

    incompleteTurns = 0;
    let completed = false;
    let capHit = false;
    let inspected = false;
    for (const call of turn.toolCalls) {
      if (completed || capHit || toolCalls >= cap) {
        // Every tool call needs a result message or the next request is invalid.
        capHit = true;
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: [
            {
              type: "text",
              text: completed
                ? "Not executed: report already submitted."
                : "Not executed: tool-call budget cap reached.",
            },
          ],
        });
        continue;
      }
      toolCalls++;
      await opts.onEvent("tool_call", { name: call.name, args: call.args });
      const tool = byName.get(call.name);
      let result: ToolResult;
      if (inspected || (recoveryTool && call.name !== recoveryTool)) {
        const text = inspected
          ? "Not executed: read the inspection result before choosing the next action or reporting."
          : `Not executed: call \`${recoveryTool}\` to inspect the failed action before continuing or reporting.`;
        result = { succeeded: false, content: [{ type: "text", text }] };
      } else {
        result = await executeTool(tool, call);
        if (call.name === recoveryTool) {
          recoveryTool = undefined;
          inspected = true;
        } else if (!result.succeeded && tool?.recoveryTool) {
          recoveryTool = tool.recoveryTool;
          await opts.onEvent("agent_recovery", { failedTool: call.name, recoveryTool });
        }
      }
      await opts.onEvent("tool_result", {
        name: call.name, succeeded: result.succeeded,
        result: result.content.filter((part) => part.type === "text"),
      });
      messages.push({ role: "tool", toolCallId: call.id, content: result.content });
      completed = result.succeeded && call.name === opts.completionTool;
    }
    if (completed) return finish("done");
    if (capHit) return finish("cap_hit");
  }
}

interface ToolResult {
  content: ContentPart[];
  succeeded: boolean;
}

async function executeTool(tool: AgentTool | undefined, call: ToolCall): Promise<ToolResult> {
  if (!tool) return { content: [{ type: "text", text: `Unknown tool: ${call.name}` }], succeeded: false };
  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) {
    return { content: [{ type: "text", text: `Invalid arguments: ${parsed.error.message}` }], succeeded: false };
  }
  try {
    return { content: await tool.execute(parsed.data), succeeded: true };
  } catch (err) {
    // Browser actions never auto-retry: the model sees the failure and decides.
    // Redacted: tool errors quote commands and URLs, and this text is sent to
    // the model provider.
    return { content: [{ type: "text", text: redact(`Tool failed: ${(err as Error).message}`) }], succeeded: false };
  }
}

// One-shot, no tools: Q&A mode and test-plan generation. Pass parts instead of
// a string to place a prompt-cache breakpoint.
export async function complete(
  adapter: ProviderAdapter,
  cred: Credential,
  model: string,
  system: string,
  prompt: string | ContentPart[],
): Promise<{ text: string; usage?: TokenUsage }> {
  const content = typeof prompt === "string" ? [{ type: "text" as const, text: prompt }] : prompt;
  const turn = await chatTurn(adapter, { model, system, messages: [{ role: "user", content }] }, cred);
  return { text: turn.text, usage: turn.usage };
}
