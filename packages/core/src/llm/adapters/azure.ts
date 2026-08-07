import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

// The credential blob is JSON, not a bare key — built by the web form.
interface AzureCredentialBlob {
  apiKey: string;
  resourceName: string;
}

const API_VERSION = "2025-01-01-preview";

// Models are deployment names on the resource the credential points at —
// currently the company Sweden-Central resource, which deploys these two.
class AzureAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super("azure", ["gpt-5-5-se", "gpt-5-4-se"], "");
  }

  protected override resolve(token: string) {
    const blob = JSON.parse(token) as AzureCredentialBlob;
    // Azure shows the endpoint as a URL, so that's what gets pasted into the
    // resource-name field; the bare name is what belongs in the host.
    const resource = blob.resourceName
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\.openai\.azure\.com\/?$/, "");
    return {
      baseUrl: `https://${resource}.openai.azure.com/openai`,
      headers: { "api-key": blob.apiKey },
    };
  }

  // The /openai/v1 surface 404s DeploymentNotFound on these deployments.
  protected override chatUrl(baseUrl: string, model: string): string {
    return `${baseUrl}/deployments/${model}/chat/completions?api-version=${API_VERSION}`;
  }
}

export const azure = new AzureAdapter();
