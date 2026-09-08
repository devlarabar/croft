import { getConfig } from "@croft/core";
import { LearningsPage } from "../../components/learnings-page";
import { getLearnings } from "../../data/learnings";
import { queryValue, type QueryPageProps } from "../../page-query";

export default async function Page({ searchParams }: QueryPageProps) {
  const cfg = await getConfig();
  const learnings = await getLearnings();
  return <LearningsPage repos={cfg.repos} learnings={learnings} notice={queryValue((await searchParams).notice)} />;
}
