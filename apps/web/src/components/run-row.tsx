"use client";

import { useState } from "react";
import { ChevronRight, Play } from "lucide-react";
import type { DashboardRole } from "@croft/core";
import type { RunListItem } from "./runs.types";
import { StatusCell } from "./status-cell";
import { CopyButton } from "./copy-button";
import { RunActions } from "./run-actions";
import { Button, ButtonLink } from "./button";

interface RunRowProps {
  run: RunListItem;
  role: DashboardRole;
}

export function RunRow({ run, role }: RunRowProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr>
        <td>
          <a className="pr-link" href={`https://github.com/${run.repo}/pull/${run.prNumber}`} target="_blank" rel="noreferrer">
            {run.repo}#{run.prNumber}
          </a>
          <div className="caption muted">{run.model}</div>
        </td>
        <td>{run.mode}</td>
        <td>
          {run.error ? (
            <Button className={`status status-${run.status}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`error-${run.id}`}>
              {run.status}<ChevronRight size={14} aria-hidden="true" />
            </Button>
          ) : <StatusCell status={run.status} />}
        </td>
        <td className="mono">
          {run.createdAt.toISOString().slice(0, 16).replace("T", " ")}
          {run.finishedAt ? <div className="caption muted">→ {run.finishedAt.toISOString().slice(11, 16)}</div> : null}
        </td>
        <td><div className="artifacts">
          <ButtonLink className="icon-button" href={`/runs/${run.id}`} aria-label="View video" title="View video"><Play size={15} aria-hidden="true" /></ButtonLink>
          <RunActions run={run} role={role} />
        </div></td>
      </tr>
      {open && run.error ? (
        <tr className="error-row" id={`error-${run.id}`}>
          <td colSpan={5}><div className="run-error"><p>{run.error}</p><CopyButton text={run.error} /></div></td>
        </tr>
      ) : null}
    </>
  );
}
