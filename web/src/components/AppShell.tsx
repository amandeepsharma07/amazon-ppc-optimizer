"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

/* Icons are inline so the menu renders instantly with the page and needs no
   icon font or network request. */
const ICONS: Record<string, React.ReactNode> = {
  analyze: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3 17V9m5 8V4m5 13v-6m5 6V7" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" />
    </svg>
  ),
  keywords: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12.5 3.5a4 4 0 1 0-3.2 6.4L4 15.2V17h1.8l1-1h1.4v-1.4h1.4l1.3-1.3a4 4 0 0 0 1.6-9.8z" />
      <circle cx="13.4" cy="6.6" r=".9" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="7.5" cy="7" r="3" />
      <path d="M2 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M14 5.5a2.8 2.8 0 0 1 0 5.4M15 12.5c2 .6 3 2.3 3 4.5" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="M12.4 12.4 17 17" />
    </svg>
  ),
  plug: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M7 2.5v4M13 2.5v4M4.5 6.5h11v3a5.5 5.5 0 0 1-11 0zM10 15v3" />
    </svg>
  ),
  build: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 3.5h9l3 3V16a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 4 16z" />
      <path d="M12.5 3.5V7H16M6.5 10h7M6.5 13h4.5" />
    </svg>
  ),
  extension: (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8.4 3.4a1.6 1.6 0 0 1 3.2 0v1.1h2.6a.7.7 0 0 1 .7.7v2.6h1.1a1.6 1.6 0 0 1 0 3.2h-1.1v2.6a.7.7 0 0 1-.7.7h-2.6v1.1a1.6 1.6 0 0 1-3.2 0v-1.1H5.8a.7.7 0 0 1-.7-.7v-2.6H4a1.6 1.6 0 0 1 0-3.2h1.1V5.2a.7.7 0 0 1 .7-.7h2.6z" />
    </svg>
  ),
};

export interface NavUser {
  email: string;
  name: string;
  role: string;
}

export default function AppShell({
  user, title, subtitle, children,
}: {
  user: NavUser;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  /* Grouped, because the menu now covers two different jobs: working out what
     to bid, and working out what to write. */
  const groups = [
    {
      title: "Advertising",
      items: [
        { href: "/", icon: "analyze", label: "Analyze", hint: "Upload reports" },
        { href: "/history", icon: "history", label: "History", hint: "Past runs" },
      ],
    },
    {
      title: "Listings",
      items: [
        { href: "/keyword-research", icon: "search", label: "Keyword research", hint: "Magnet and Cerebro" },
        { href: "/keyword-tools", icon: "keywords", label: "Keyword processor", hint: "Clean and rank lists" },
        { href: "/listing-builder", icon: "build", label: "Listing builder", hint: "Write with coverage" },
        { href: "/backend-keywords", icon: "keywords", label: "Backend keywords", hint: "Search Terms field" },
        { href: "/extension", icon: "extension", label: "Chrome extension", hint: "Audit live listings" },
      ],
    },
    ...(user.role === "admin"
      ? [{
        title: "Admin",
        items: [
          { href: "/admin", icon: "team", label: "Team", hint: "Who has access" },
          { href: "/settings", icon: "plug", label: "Amazon connection", hint: "Automatic data" },
        ],
      }]
      : []),
  ];

  return (
    <div className="layout">
      <aside className={`sidebar${open ? " open" : ""}`}>
        <div className="sidebar-brand">
          <span className="brand-mark" aria-hidden="true">PPC</span>
          <span className="brand-name">Optimizer</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {groups.map(group => (
            <div key={group.title} className="nav-group">
              <div className="nav-group-title">{group.title}</div>
              {group.items.map(item => {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <span className="nav-icon">{ICONS[item.icon]}</span>
                    <span className="nav-text">
                      <span className="nav-label">{item.label}</span>
                      <span className="nav-hint">{item.hint}</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <div className="who-name">{user.name || user.email.split("@")[0]}</div>
            <div className="who-email" title={user.email}>{user.email}</div>
            {user.role === "admin" && <span className="chip warn">admin</span>}
          </div>
          <button className="btn-ghost signout" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <div className="main">
        <header className="page-head">
          <button
            className="menu-toggle"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14" /></svg>
          </button>
          <div>
            <h1 className="page">{title}</h1>
            {subtitle && <p className="page-sub">{subtitle}</p>}
          </div>
        </header>
        <div className="page-body">{children}</div>
      </div>

      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
    </div>
  );
}
