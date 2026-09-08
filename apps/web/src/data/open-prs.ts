import { getConfig, listOpenPrs } from "@croft/core";

export interface OpenPr {
  repo: string;
  number: number;
  title: string;
}

export async function getOpenPrs(): Promise<OpenPr[]> {
  const cfg = await getConfig();
  const prs: OpenPr[] = [];
  for (const repo of cfg.repos) {
    for (const pr of await listOpenPrs(repo)) {
      prs.push({ repo, number: pr.number, title: pr.title });
    }
  }
  return prs;
}
