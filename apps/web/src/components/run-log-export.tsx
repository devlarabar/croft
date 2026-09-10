"use client";

import { useEffect, useRef } from "react";
import { Copy, Download } from "lucide-react";
import { useCopy } from "../hooks/use-copy";
import { Button, ButtonLink } from "./button";

interface RunLogExportProps {
  runId: string;
}

export function RunLogExport({ runId }: RunLogExportProps) {
  const { copied, failed, pending, copy } = useCopy();
  const request = useRef<AbortController | null>(null);
  const url = `/runs/${runId}/logs.json`;
  useEffect(() => () => request.current?.abort(), []);

  function copyLogs() {
    request.current?.abort();
    request.current = new AbortController();
    const json = fetch(url, { signal: request.current.signal, redirect: "error", cache: "no-store" }).then((response) => {
      if (!response.ok) throw new Error("Log export failed");
      return response.text();
    });
    void copy(json);
  }

  return (
    <div>
      <div className="form-row">
        <Button className="secondary" type="button" disabled={pending} onClick={copyLogs}>
          <Copy size={16} aria-hidden="true" />{copied ? "Copied JSON" : "Copy JSON"}
        </Button>
        <ButtonLink className="secondary" href={url} download><Download size={16} aria-hidden="true" />Download JSON</ButtonLink>
      </div>
      {failed ? <p role="alert">Could not copy logs. Try again or use Download JSON.</p> : null}
    </div>
  );
}
