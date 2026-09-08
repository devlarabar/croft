"use client";

import { useCopy } from "../hooks/use-copy";
import { Button } from "./button";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const { copied, copy } = useCopy(text);
  return <Button className="link copy" onClick={copy}>{copied ? "⎘ Copied" : "⎘ Click to copy"}</Button>;
}
