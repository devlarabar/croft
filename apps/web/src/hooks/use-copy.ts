"use client";

import { useState } from "react";

export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return { copied, copy };
}
