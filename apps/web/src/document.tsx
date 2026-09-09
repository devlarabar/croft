import type { ReactNode } from "react";

interface DocumentProps {
  children: ReactNode;
}

export function Document({ children }: DocumentProps) {
  return (
    <html lang="en">
      <head><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="/styles.css" /></head>
      <body>{children}</body>
    </html>
  );
}
