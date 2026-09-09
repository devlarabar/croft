import type { PropsWithChildren } from "react";

export function Notice({ children }: PropsWithChildren) {
  if (!children) return null;
  return <div className="notice" role="status">{children}</div>;
}
