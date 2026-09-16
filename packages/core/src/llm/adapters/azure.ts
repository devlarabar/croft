import { z } from "zod";
import { OpenAiCompatibleAdapter } from "./openai-compatible.js";

const azureCredentialSchema = z.object({ apiKey: z.string().min(1), resourceName: z.string() });
const resourceNameSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$/);

const API_VERSION = "2025-01-01-preview";

// Models are deployment names on the resource the credential points at —
// currently the company Sweden-Central resource, which deploys these two.
class AzureAdapter extends OpenAiCompatibleAdapter {
  constructor() {
    super("azure", ["gpt-5-5-se", "gpt-5-4-se"], "");
  }

  protected override resolve(token: string) {
    const blob = azureCredentialSchema.parse(JSON.parse(token));
    // Azure shows the endpoint as a URL, so that's what gets pasted into the
    // resource-name field; the bare name is what belongs in the host.
    const resource = blob.resourceName
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\.openai\.azure\.com\/?$/, "");
    if (!resourceNameSchema.safeParse(resource).success) {
      throw new Error("Invalid Azure resource. Enter its resource name or HTTPS Azure endpoint.");
    }
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
