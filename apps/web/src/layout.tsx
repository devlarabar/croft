import type { ReactNode } from "react";
import type { DashboardRole } from "@croft/core";
import { clsx } from "clsx";
import { BookMarked, BookOpen, Download, ExternalLink, ListChecks, MessageSquare, Network, PlusCircle, SlidersHorizontal, Users } from "lucide-react";

const NAV = [
  { label: "Arbeid", items: [
    { href: "/runs", label: "Runs", icon: ListChecks },
    { href: "/new", label: "New run", icon: PlusCircle },
    { href: "/chat", label: "Ask about a PR", icon: MessageSquare },
  ] },
  { label: "Administrasjon", items: [
    { href: "/models", label: "Models", icon: Network },
    { href: "/learnings", label: "Learnings", icon: BookMarked },
    { href: "/settings", label: "Settings", icon: SlidersHorizontal },
    { href: "/users", label: "Users", icon: Users },
    { href: "/export", label: "Export & clean up", icon: Download },
    { href: "/api/docs", label: "API docs", icon: BookOpen },
  ] },
];

interface LayoutProps {
  title: string;
  children: ReactNode;
  role?: DashboardRole;
}

export function Layout({ title, children, role = "admin" }: LayoutProps) {
  return (
    <div className="dashboard">
      <title>{`${title} — Croft`}</title>
      {role !== "user" ? (
        <aside className="sidebar">
          <a className="brand" href="/runs">
            <strong>Croft</strong>
            <span>Reviews and tests your pull requests.</span>
          </a>
          <nav aria-label="Dashboard">
            {NAV.map((group) => {
              const items = group.items.filter((item) => role === "admin" || item.href === "/runs");
              if (!items.length) return null;
              return (
                <div className="nav-group" key={group.label}>
                  <span className="section-label">{group.label}</span>
                  {items.map(({ href, label, icon: Icon }) => (
                    <a key={href} href={href} className={clsx("nav-link", { active: label === title })} aria-current={label === title ? "page" : undefined}>
                      <Icon size={17} aria-hidden="true" />{label}
                    </a>
                  ))}
                </div>
              );
            })}
          </nav>
          {role === "admin" ? (
            <div className="sidebar-footer">
              <a href="https://github.com/devlarabar/croft" target="_blank" rel="noreferrer"><ExternalLink size={16} aria-hidden="true" />GitHub</a>
              <span>Webhook: /api/webhooks/github</span>
            </div>
          ) : null}
        </aside>
      ) : null}
      <main><div className="page-content">{children}</div></main>
    </div>
  );
}
