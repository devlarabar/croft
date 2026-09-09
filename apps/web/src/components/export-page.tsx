import { Download } from "lucide-react";
import { Layout } from "../layout";
import { Fieldset } from "./fieldset";
import { Button } from "./button";
import { PageHeader } from "./page-header";
import { Notice } from "./notice";

interface ExportPageProps {
  notice?: string;
}

export function ExportPage({ notice }: ExportPageProps) {
  return (
    <Layout title="Export & clean up">
      <PageHeader title="Export & clean up" description="Take run data out, or remove it for good." />
      <Notice>{notice}</Notice>
      <Fieldset legend="Download zip">
        <form method="get" action="/api/export">
          <label>Runs older than<input name="before" type="date" required /></label>
          <Button className="secondary"><Download size={16} aria-hidden="true" />Download zip</Button>
        </form>
        <p className="caption">Artifacts already removed by the 60-day storage lifecycle rule are skipped.</p>
      </Fieldset>
      <Fieldset legend="Delete data older than" danger>
        <p>Runs, reports and videos before this date are deleted permanently. Type <strong>delete</strong> to confirm.</p>
        <form method="post" action="/api/purge">
          <label>Date<input name="before" type="date" required /></label>
          <label>Confirm<input name="confirm" placeholder="delete" pattern="delete" required /></label>
          <Button className="danger">Delete</Button>
        </form>
      </Fieldset>
    </Layout>
  );
}
