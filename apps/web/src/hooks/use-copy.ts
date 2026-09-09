"use client";

import { useState } from "react";

export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);

  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  return { copied, failed, copy };
}
