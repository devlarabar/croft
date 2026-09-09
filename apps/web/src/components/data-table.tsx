import type { ComponentProps } from "react";

type DataTableProps = ComponentProps<"table">;

export function DataTable({ children, className, ...props }: DataTableProps) {
  return <div className="table-card"><table {...props} className={className}>{children}</table></div>;
}
