"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function TopBar({ email, role }: { email: string; role: string }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  const links = [
    { href: "/", label: "Analyze" },
    { href: "/history", label: "History" },
    ...(role === "admin" ? [{ href: "/admin", label: "Team" }] : []),
  ];

  return (
    <header className="topbar">
      <span className="brand">PPC Optimizer</span>
      <nav>
        {links.map(l => (
          <Link key={l.href} href={l.href} className={pathname === l.href ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </nav>
      <span className="who">{email}{role === "admin" ? " · admin" : ""}</span>
      <button className="btn-link" onClick={signOut}>Sign out</button>
    </header>
  );
}
