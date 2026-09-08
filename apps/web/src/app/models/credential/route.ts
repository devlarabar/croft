import { db, encrypt, getProvider, schema } from "@croft/core";
import { redirect, route } from "../../../http";

export const POST = route(async (request) => {
  const form = await request.formData();
  const providerId = String(form.get("providerId"));
  getProvider(providerId);
  const apiKey = String(form.get("apiKey"));
  let secret = apiKey;
  if (providerId === "azure") {
    secret = JSON.stringify({ apiKey, resourceName: String(form.get("resourceName")) });
  } else if (providerId === "bedrock") {
    secret = JSON.stringify({
      accessKeyId: apiKey,
      secretAccessKey: String(form.get("secretAccessKey")),
      region: String(form.get("region")),
    });
  }
  await db.insert(schema.credentials).values({ providerId, kind: "api_key", encrypted: encrypt(secret) });
  return redirect("/models?notice=API+key+saved");
});
