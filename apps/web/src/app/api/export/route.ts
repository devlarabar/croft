import { exportZip } from "../../../export";
import { route } from "../../../http";

export const GET = route(async (request) => {
  const before = new Date(new URL(request.url).searchParams.get("before") ?? "");
  if (Number.isNaN(before.getTime())) return new Response("invalid date", { status: 400 });
  return new Response(await exportZip(before), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="croft-export-${before.toISOString().slice(0, 10)}.zip"`,
    },
  });
});
