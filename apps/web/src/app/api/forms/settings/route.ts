import { getConfig, updateConfig } from "@croft/core";
import { redirect, route } from "../../../../http";
import { settingsPatch } from "../../../../settings-form";

export const POST = route(async (request) => {
  const form = await request.formData();
  await updateConfig(settingsPatch(form, await getConfig()));
  return redirect("/settings?notice=Saved");
});
