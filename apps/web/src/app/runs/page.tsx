import { RunsPage } from "../../components/runs-page";
import { getRuns } from "../../data/runs";
import { dashboardRole } from "../../dashboard-role";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  const query = await searchParams;
  const runs = await getRuns(queryValue(query.page), queryValue(query.status));
  return <RunsPage {...runs} role={await dashboardRole()} />;
}
