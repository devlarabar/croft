import { ExportPage } from "../../components/export-page";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  return <ExportPage notice={queryValue((await searchParams).notice)} />;
}
