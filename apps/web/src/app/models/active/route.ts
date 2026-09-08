import { updateConfig } from "@croft/core";
import { z } from "zod";
import { redirect, route } from "../../../http";

export const POST = route(async (request) => {
  const form = await request.formData();
  const [providerId, ...rest] = String(form.get("model")).split("/");
  await updateConfig({
    activeModel: {
      providerId: z.string().parse(providerId),
      model: rest.join("/"),
      credentialId: String(form.get("credentialId")),
    },
  });
  return redirect("/models?notice=Active+model+updated");
});
