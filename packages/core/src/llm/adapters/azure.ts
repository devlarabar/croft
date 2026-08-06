import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

// The credential blob is JSON, not a bare key — built by the web form.
interface AzureCredentialBlob {
  apiKey: string;
  resourceName: string;
}

// Azure's OpenAI-compatible v1 surface. The model field is the deployment
// name, so deployments must be named exactly after these models.
class AzureAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super("azure", ["gpt-5", "gpt-4.1", "gpt-4o"], "");
  }

  protected override resolve(token: string) {
    const blob = JSON.parse(token) as AzureCredentialBlob;
    return {
      baseUrl: `https://${blob.resourceName}.openai.azure.com/openai/v1`,
      headers: { "api-key": blob.apiKey },
    };
  }
}

export const azure = new AzureAdapter();
