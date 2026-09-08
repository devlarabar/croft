import { Layout } from "../layout";
import { Fieldset } from "./fieldset";
import { Button } from "./button";
interface ExportPageProps {
  notice?: string;
}

export function ExportPage({ notice }: ExportPageProps) {
  return (
    <Layout title="Export & clean up">
      <h1>Export &amp; clean up</h1>
      {notice ? <p>{notice}</p> : null}
      <Fieldset legend="Download zip">
        <form method="get" action="/api/export">
          <label>
            Runs older than <input name="before" type="date" required />
          </label>{" "}
          <Button>Download zip</Button>
        </form>
        <p>Artifacts already removed by the 60-day storage lifecycle rule are skipped.</p>
      </Fieldset>
      <Fieldset legend="Delete data older than">
        <form method="post" action="/api/purge">
          <label>
            Date <input name="before" type="date" required />
          </label>{" "}
          <label>
            Type <code>delete</code> to confirm <input name="confirm" required />
          </label>{" "}
          <Button className="danger">Delete</Button>
        </form>
      </Fieldset>
    </Layout>
  );
}
