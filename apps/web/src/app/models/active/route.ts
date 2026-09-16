import { CredentialProviderMismatchError, getProvider, loadCredential, updateConfig } from "@croft/core";
import { z } from "zod";
import { redirect, route } from "../../../http";

export const POST = route(async (request) => {
  const form = await request.formData();
  const [providerId, ...rest] = String(form.get("model")).split("/");
  const provider = getProvider(z.string().parse(providerId));
  if (!provider.models.includes(rest.join("/"))) return new Response("Select a supported model.", { status: 400 });
  try {
    await loadCredential(String(form.get("credentialId")), provider);
  } catch (error) {
    if (!(error instanceof CredentialProviderMismatchError)) throw error;
    return redirect("/models?notice=Select+a+credential+from+the+same+provider+as+the+model.");
  }
  await updateConfig({
    activeModel: {
      providerId: z.string().parse(providerId),
      model: rest.join("/"),
      credentialId: String(form.get("credentialId")),
    },
  });
  return redirect("/models?notice=Active+model+updated");
});
