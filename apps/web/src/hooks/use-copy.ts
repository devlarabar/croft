"use client";

import { useState } from "react";

type CopyStatus = "idle" | "copying" | "copied" | "failed";

export function useCopy() {
  const [status, setStatus] = useState<CopyStatus>("idle");

  async function copy(text: string | Promise<string>) {
    setStatus("copying");
    try {
      if (typeof text === "string") {
        await navigator.clipboard.writeText(text);
      } else {
        // Safari requires the clipboard write to start during the click gesture.
        const item = new ClipboardItem({ "text/plain": text });
        await Promise.all([text, navigator.clipboard.write([item])]);
      }
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return { copied: status === "copied", failed: status === "failed", pending: status === "copying", copy };
}
