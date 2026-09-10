"use client";

import { useCopy } from "../hooks/use-copy";
import { Button } from "./button";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const { copied, failed, pending, copy } = useCopy();
  return <div><Button type="button" className="copy" disabled={pending} onClick={() => copy(text)}>{copied ? "Kopiert" : "Kopier"}</Button>{failed ? <p role="alert">Could not copy. Try again or select the text manually.</p> : null}</div>;
}
