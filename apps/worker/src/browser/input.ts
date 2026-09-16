import type { Page } from "playwright";
import { z } from "zod";
import type { AgentTool } from "@croft/core/llm/loop";

const keys = [
  "Enter", "Shift+Enter", "Tab", "Shift+Tab", "Escape", "Backspace", "Delete",
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End",
  "PageUp", "PageDown", "ControlOrMeta+A",
] as const;
const pressArgs = z.object({ key: z.enum(keys) });
const pasteArgs = z.object({ text: z.string() });

async function writeClipboard(page: Page, text: string) {
  const session = await page.context().newCDPSession(page);
  try {
    const { frameTree } = await session.send("Page.getFrameTree");
    // Isolated worlds keep page scripts from replacing the clipboard API.
    const { executionContextId } = await session.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
    });
    const result = await session.send("Runtime.callFunctionOn", {
      executionContextId,
      functionDeclaration: "function(text) { return navigator.clipboard.writeText(text); }",
      arguments: [{ value: text }],
      userGesture: true,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error("Could not write the browser clipboard. Use a secure page with clipboard support.");
  } finally {
    await session.detach();
  }
}

export function makeBrowserInputTools(page: Page): AgentTool[] {
  return [
    {
      recoveryTool: "browser_snapshot",
      def: {
        name: "browser_press_key",
        description: "Press one editing or navigation key in the focused element. Click the target first. Call twice for two Enter presses.",
        inputSchema: {
          type: "object",
          properties: { key: { type: "string", enum: [...keys] } },
          required: ["key"],
        },
      },
      schema: pressArgs,
      async execute(args) {
        const { key } = pressArgs.parse(args);
        await page.keyboard.press(key);
        return [{ type: "text", text: `Pressed ${key}.` }];
      },
    },
    {
      recoveryTool: "browser_snapshot",
      def: {
        name: "browser_paste",
        description: "Paste supplied plain text into the focused element using a real clipboard paste, preserving newlines. Click the target first. Requires HTTPS or localhost. Replaces and then clears the browser clipboard; does not read existing clipboard contents.",
        inputSchema: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
      },
      schema: pasteArgs,
      async execute(args) {
        const { text } = pasteArgs.parse(args);
        await page.bringToFront();
        try {
          await writeClipboard(page, text);
          await page.keyboard.press("ControlOrMeta+V");
        } finally {
          try {
            await writeClipboard(page, "");
          } catch {
            await page.context().close();
            throw new Error("Clipboard cleanup failed; browser session closed.");
          }
        }
        return [{ type: "text", text: "Pasted plain text into the focused element." }];
      },
    },
  ];
}
