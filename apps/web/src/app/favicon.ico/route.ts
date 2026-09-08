import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { route } from "../../http";

export const GET = route(async () => new Response(new Uint8Array(await readFile(join(process.cwd(), "public/favicon.png"))), {
  headers: { "Content-Type": "image/png" },
}));
