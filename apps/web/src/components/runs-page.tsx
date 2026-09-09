import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { clsx } from "clsx";
import { Layout } from "../layout";
import { runFilterSchema } from "../run-pagination";
import type { RunsPageProps } from "./runs.types";
import { RunRow } from "./run-row";
import { DataTable } from "./data-table";
import { ButtonLink } from "./button";
import { PageHeader } from "./page-header";

export function RunsPage({ runs, page, pageTotal, total, status, role }: RunsPageProps) {
  return (
    <Layout title="Runs" role={role}>
      <PageHeader title="Runs" description="Reviews and test runs Croft has done. Videos are kept for 60 days.">
        {role === "admin" ? <ButtonLink href="/new"><Plus size={16} aria-hidden="true" />New run</ButtonLink> : null}
      </PageHeader>
      <div className="filters" aria-label="Filter runs by status">
        {runFilterSchema.options.map((filter) => (
          <ButtonLink key={filter} href={`/runs?status=${filter}`} className={clsx("small", { secondary: filter !== status })} aria-current={filter === status ? "true" : undefined}>
            {filter === "all" ? "alle" : filter}
          </ButtonLink>
        ))}
        <span className="caption muted">{total} runs</span>
      </div>
      <div>
        <DataTable className="runs-table">
          <thead><tr><th>Pull request</th><th>Mode</th><th>Status</th><th>Timing</th><th>Artifacts</th></tr></thead>
          <tbody>
            {runs.map((run) => <RunRow key={run.id} run={run} role={role} />)}
            {runs.length === 0 ? <tr><td colSpan={5}>No runs match this filter.</td></tr> : null}
          </tbody>
          <tfoot><tr><td colSpan={5}>
            <div className="pagination">
              <span className="caption muted">Side {page} av {pageTotal}</span>
              <div className="flex gap-2">
                <ButtonLink className="secondary small" href={page > 1 ? `/runs?status=${status}&page=${page - 1}` : undefined} aria-disabled={page === 1}><ChevronLeft size={16} aria-hidden="true" />Forrige</ButtonLink>
                <ButtonLink className="secondary small" href={page < pageTotal ? `/runs?status=${status}&page=${page + 1}` : undefined} aria-disabled={page === pageTotal}>Neste<ChevronRight size={16} aria-hidden="true" /></ButtonLink>
              </div>
            </div>
          </td></tr></tfoot>
        </DataTable>
      </div>
    </Layout>
  );
}
