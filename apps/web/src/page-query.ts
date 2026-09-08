export type PageQuery = Record<string, string | string[] | undefined>;

export interface QueryPageProps {
  searchParams: Promise<PageQuery>;
}

export function queryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
