import type { DashboardRole } from "@croft/core";
import type { Run } from "./runs.types";
import { isCancelable, isRetryable } from "../run-status";
import { Button } from "./button";
import { RefreshCw, X } from "lucide-react";

interface RunActionsProps {
  run: Pick<Run, "id" | "status">;
  role: DashboardRole;
}

export function RunActions({ run, role }: RunActionsProps) {
  if (role !== "admin") return null;
  let action: string;
  if (isRetryable(run.status)) action = "retry";
  else if (isCancelable(run.status)) action = "cancel";
  else return null;
  return (
    <form method="post" action={`/runs/${run.id}/${action}`}>
      <Button className="icon-button" aria-label={action} title={action}>
        {action === "retry" ? <RefreshCw size={15} aria-hidden="true" /> : <X size={15} aria-hidden="true" />}
      </Button>
    </form>
  );
}
