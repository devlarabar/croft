import { getConfig, PROVIDERS } from "@croft/core";
import { ModelsPage } from "../../components/models-page";
import { getCredentials } from "../../data/credentials";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  const cfg = await getConfig();
  const creds = await getCredentials();
  return <ModelsPage providers={Object.values(PROVIDERS)} creds={creds} active={cfg.activeModel} notice={queryValue((await searchParams).notice)} />;
}
