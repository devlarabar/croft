import { Readable } from "node:stream";
import archiver from "archiver";
import { inArray, lt } from "drizzle-orm";
import { db, deleteArtifacts, getArtifactStream, listArtifactKeys, schema } from "@croft/core";

function appendAndWait(archive: archiver.Archiver, source: Readable | string, name: string): Promise<void> {
  return new Promise((resolve) => {
    archive.once("entry", () => resolve());
    archive.append(source, { name });
  });
}

// Streams the zip — never buffered. Level 1: payloads are webm/png.
export async function exportZip(before: Date): Promise<ReadableStream> {
  const runs = await db.select().from(schema.runs).where(lt(schema.runs.createdAt, before));
  const runIds = runs.map((run) => run.id);
  const events = runIds.length
    ? await db.select().from(schema.events).where(inArray(schema.events.runId, runIds))
    : [];

  const archive = archiver("zip", { zlib: { level: 1 } });
  const root = `export-${before.toISOString().slice(0, 10)}`;
  void (async () => {
    try {
      await appendAndWait(archive, runs.map((run) => JSON.stringify(run)).join("\n"), `${root}/runs.jsonl`);
      await appendAndWait(archive, events.map((event) => JSON.stringify(event)).join("\n"), `${root}/events.jsonl`);
      for (const id of runIds) {
        for (const key of await listArtifactKeys(`${id}/`)) {
          // The 60-day lifecycle rule may have deleted the object already.
          const stream = await getArtifactStream(key);
          if (stream) await appendAndWait(archive, stream as Readable, `${root}/artifacts/${key}`);
        }
      }
      await archive.finalize();
    } catch (err) {
      archive.destroy(err as Error);
    }
  })();
  return Readable.toWeb(archive) as ReadableStream;
}

export async function purge(before: Date): Promise<number> {
  const runs = await db.select({ id: schema.runs.id }).from(schema.runs).where(lt(schema.runs.createdAt, before));
  const runIds = runs.map((run) => run.id);
  if (runIds.length === 0) return 0;
  const keys: string[] = [];
  for (const id of runIds) keys.push(...(await listArtifactKeys(`${id}/`)));
  await deleteArtifacts(keys);
  await db.delete(schema.events).where(inArray(schema.events.runId, runIds));
  await db.delete(schema.runs).where(inArray(schema.runs.id, runIds));
  return runIds.length;
}
