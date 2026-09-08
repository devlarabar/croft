import { RunsPage } from "../../components/runs-page";
import { getRuns } from "../../data/runs";
import { dashboardRole } from "../../dashboard-role";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  const runs = await getRuns(queryValue((await searchParams).page));
  return <RunsPage {...runs} role={await dashboardRole()} />;
}
