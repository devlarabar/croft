import { createElement } from "react";
import { ApiDocsPage } from "../../../components/api-docs-page";
import { html } from "../../../html";

export function GET() {
  return html(createElement(ApiDocsPage));
}
