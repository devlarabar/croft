import type { RunStatus } from "@croft/core";

export function isRetryable(status: RunStatus): boolean {
  return status === "failed" || status === "error" || status === "partial" || status === "canceled";
}

export function isCancelable(status: RunStatus): boolean {
  return status === "queued" || status === "starting" || status === "running";
}
