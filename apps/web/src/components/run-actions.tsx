import type { DashboardRole } from "@croft/core";
import type { Run } from "./runs.types";
import { isCancelable, isRetryable } from "../run-status";
import { Button } from "./button";

interface RunActionsProps {
  run: Run;
  role: DashboardRole;
}

export function RunActions({ run, role }: RunActionsProps) {
  if (role !== "admin") return null;
  let action: string;
  if (isRetryable(run.status)) action = "retry";
  else if (isCancelable(run.status)) action = "cancel";
  else return null;
  return (
    <form method="post" action={`/runs/${run.id}/${action}`} className="inline ml-3">
      <Button className="link">{action}</Button>
    </form>
  );
}
