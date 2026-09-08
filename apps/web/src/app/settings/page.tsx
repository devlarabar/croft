import { getConfig } from "@croft/core";
import { SettingsPage } from "../../components/settings-page";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  return <SettingsPage cfg={await getConfig()} notice={queryValue((await searchParams).notice)} />;
}
