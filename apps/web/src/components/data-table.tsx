import type { PropsWithChildren } from "react";

export function DataTable({ children }: PropsWithChildren) {
  return <table className="runs-table"><tbody>{children}</tbody></table>;
}
