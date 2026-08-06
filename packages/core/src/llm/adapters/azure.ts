import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

// The credential blob is JSON, not a bare key — built by the web form.
interface AzureCredentialBlob {
  apiKey: string;
  resourceName: string;
}

// Azure's OpenAI-compatible v1 surface. The model field is the deployment
// name, so this list must match the deployments on the resource the
// credential points at — currently the company Sweden-Central resource.
class AzureAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super("azure", ["gpt-5-5-se", "gpt-5-6-sol-se", "gpt-5-6-terra-se", "gpt-5-6-luna-se"], "");
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
