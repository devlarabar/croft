import { Layout } from "../layout";
import { openApiSpec } from "../openapi";
import { DataTable } from "./data-table";
import { Card } from "./card";
import { PageHeader } from "./page-header";

export function ApiDocsPage() {
  return (
    <Layout title="API docs">
      <PageHeader title="API docs" description={<>Read Croft’s current activity over HTTP. Send your API key as <strong>X-API-Key</strong>.</>} />
      <DataTable>
        <tbody>{Object.entries(openApiSpec.paths).map(([path, operations]) => (
          <tr key={path}><td className="caption">GET</td><td>{path}</td><td className="muted">{operations.get.summary}</td></tr>
        ))}</tbody>
      </DataTable>
      <Card>
        <h2 className="section-label">Get latest activity</h2>
        <pre>{'curl https://croft.example.com/api/v1/activity \\\n  -H "X-API-Key: $CROFT_API_KEY"'}</pre>
      </Card>
      <details>
        <summary>Interactive API reference</summary>
        <div id="swagger-ui" />
      </details>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.14/swagger-ui.css" />
      <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.14/swagger-ui-bundle.js" crossOrigin="anonymous" />
      <script dangerouslySetInnerHTML={{ __html: "window.addEventListener('load', () => { window.ui = SwaggerUIBundle({ dom_id: '#swagger-ui', url: '/api/openapi.json' }); });" }} />
    </Layout>
  );
}
