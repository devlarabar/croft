import type { ReactNode } from "react";
import type { DashboardRole } from "@croft/core";
import { clsx } from "clsx";

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
  children: ReactNode;
  role?: DashboardRole;
}

export function Layout({ title, children, role = "admin" }: LayoutProps) {
  return (
    <>
      <title>{`${title} — Croft`}</title>
      {role !== "user" ? (
        <nav>
          <a className="brand" href="/runs">Croft</a>
          {NAV.filter(([href]) => role === "admin" || href === "/runs").map(([href, label]) => (
            <a key={href} href={href} className={clsx({ active: label === title })}>{label}</a>
          ))}
          {role === "admin" ? (
            <a className="external" href="https://github.com/devlarabar/croft" target="_blank" rel="noreferrer">GitHub ↗</a>
          ) : null}
        </nav>
      ) : null}
      <main>{children}</main>
    </>
  );
}
