import { getArtifact } from "@croft/core";
import { z } from "zod";
import { route } from "../../../../http";

export const GET = route(async (request, { params }: RouteContext<"/runs/[id]/video">) => {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response("404 Not Found", { status: 404 });
  const artifact = await getArtifact(`${id.data}/run.webm`, request.headers.get("range") ?? undefined);
  if (!artifact?.Body) return new Response("404 Not Found", { status: 404 });
  const headers = new Headers({ "Content-Type": "video/webm", "Accept-Ranges": "bytes" });
  if (artifact.ContentLength !== undefined) headers.set("Content-Length", String(artifact.ContentLength));
  if (artifact.ContentRange) headers.set("Content-Range", artifact.ContentRange);
  return new Response(artifact.Body.transformToWebStream(), { status: artifact.ContentRange ? 206 : 200, headers });
});
