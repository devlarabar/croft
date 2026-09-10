import { listEvents } from "@croft/core";
import { z } from "zod";
import { getRun } from "../../../../data/runs";
import { route } from "../../../../http";

export const GET = route(async (_request, { params }: RouteContext<"/runs/[id]/logs.json">) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success || !await getRun(id.data)) return new Response("404 Not Found", { status: 404 });
  const events = await listEvents(id.data);
  return new Response(JSON.stringify({ runId: id.data, events }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="croft-run-${id.data}-logs.json"`,
    },
  });
});
