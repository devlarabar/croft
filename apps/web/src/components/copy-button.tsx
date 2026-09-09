"use client";

import { useCopy } from "../hooks/use-copy";
import { Button } from "./button";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const { copied, failed, copy } = useCopy(text);
  return <div><Button type="button" className="copy" onClick={copy}>{copied ? "Kopiert" : "Kopier"}</Button>{failed ? <p role="alert">Could not copy. Try again or select the text manually.</p> : null}</div>;
}
