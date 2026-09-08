import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server.edge";
import { Document } from "./document";

export async function html(children: ReactNode, status = 200): Promise<Response> {
  const stream = await renderToReadableStream(<Document>{children}</Document>);
  await stream.allReady;
  return new Response(stream, { status, headers: { "Content-Type": "text/html; charset=UTF-8" } });
}
