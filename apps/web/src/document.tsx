import type { ReactNode } from "react";

interface DocumentProps {
  children: ReactNode;
}

export function Document({ children }: DocumentProps) {
  return (
    <html>
      <head><link rel="stylesheet" href="/styles.css" /></head>
      <body>{children}</body>
    </html>
  );
}
