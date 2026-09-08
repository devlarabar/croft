import { purge } from "../../../export";
import { redirect, route } from "../../../http";

export const POST = route(async (request) => {
  const form = await request.formData();
  if (form.get("confirm") !== "delete") return redirect("/export?notice=Purge+not+confirmed+—+type+delete");
  const before = new Date(String(form.get("before")));
  if (Number.isNaN(before.getTime())) return new Response("invalid date", { status: 400 });
  return redirect(`/export?notice=Deleted+${await purge(before)}+runs`);
});
