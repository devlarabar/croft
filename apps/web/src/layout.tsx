import type { Child } from "hono/jsx";
import type { DashboardRole } from "@croft/core";

const NAV = [
  ["/runs", "Runs"],
  ["/new", "New run"],
  ["/models", "Models"],
  ["/chat", "Chat"],
  ["/learnings", "Learnings"],
  ["/export", "Export & clean up"],
  ["/settings", "Settings"],
  ["/users", "Users"],
  ["/api/docs", "API docs"],
];

interface LayoutProps {
  title: string;
  children: Child;
  role?: DashboardRole;
}

export function Layout({ title, children, role = "admin" }: LayoutProps) {
  return (
    <html>
      <head>
        <title>{title} — Croft</title>
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        {role !== "user" ? (
          <nav>
            <a class="brand" href="/runs">Croft</a>
            {NAV.filter(([href]) => role === "admin" || href === "/runs").map(([href, label]) => (
              <a href={href} class={label === title ? "active" : undefined}>{label}</a>
            ))}
            {role === "admin" ? (
              <a class="external" href="https://github.com/devlarabar/croft" target="_blank" rel="noreferrer">GitHub ↗</a>
            ) : null}
          </nav>
        ) : null}
        <main>{children}</main>
      </body>
    </html>
  );
}
