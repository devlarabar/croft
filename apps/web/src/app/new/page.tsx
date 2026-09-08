import { NewRunPage } from "../../components/new-run-page";
import { getOpenPrs } from "../../data/open-prs";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  return <NewRunPage prs={await getOpenPrs()} error={queryValue((await searchParams).error)} />;
}
