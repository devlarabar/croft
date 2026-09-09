import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description: ReactNode;
  children?: ReactNode;
}

export function PageHeader({ title, description, children }: PageHeaderProps) {
  return <header className="page-head"><div><h1>{title}</h1><p className="sub">{description}</p></div>{children}</header>;
}
