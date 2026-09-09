import type { RunStatus } from "@croft/core";

interface StatusCellProps {
  status: RunStatus;
}

export function StatusCell({ status }: StatusCellProps) {
  return <span className={`status status-${status}`}>{status}</span>;
}
