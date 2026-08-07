import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

// The credential blob is JSON, not a bare key — built by the web form.
interface AzureCredentialBlob {
  apiKey: string;
  resourceName: string;
}

const API_VERSION = "2025-01-01-preview";

// Models are deployment names on the resource the credential points at —
// currently the company Sweden-Central resource.
class AzureAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super(
      "azure",
      ["gpt-5-5-se", "gpt-5-4-se", "gpt-5-6-sol-se", "gpt-5-6-terra-se", "gpt-5-6-luna-se"],
      "",
    );
  }

  protected override resolve(token: string) {
    const blob = JSON.parse(token) as AzureCredentialBlob;
    return {
      baseUrl: `https://${blob.resourceName}.openai.azure.com/openai`,
      headers: { "api-key": blob.apiKey },
    };
  }

  // The /openai/v1 surface 404s DeploymentNotFound on these deployments.
  protected override chatUrl(baseUrl: string, model: string): string {
    return `${baseUrl}/deployments/${model}/chat/completions?api-version=${API_VERSION}`;
  }
}

export const azure = new AzureAdapter();
