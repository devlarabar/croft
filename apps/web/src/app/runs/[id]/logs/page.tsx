import { notFound } from "next/navigation";
import { z } from "zod";
import { RunLogsPage } from "../../../../components/run-logs-page";
import { getRun } from "../../../../data/runs";
import { getRunEvents } from "../../../../data/run-events";
import { queryValue } from "../../../../page-query";

export default async function Page({ params, searchParams }: PageProps<"/runs/[id]/logs">) {
  const id = z.uuid().safeParse((await params).id);
  const cursor = z.coerce.number().int().positive().optional().safeParse(queryValue((await searchParams).before));
  if (!id.success || !cursor.success) notFound();
  const run = await getRun(id.data);
  if (!run) notFound();
  const events = await getRunEvents(run.id, cursor.data);
  return <RunLogsPage run={run} {...events} />;
}
