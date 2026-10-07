"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const BASE_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/insights", label: "Insights" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks({ showTeamLink }: { showTeamLink: boolean }) {
  const pathname = usePathname();
  const links = showTeamLink
    ? [...BASE_LINKS, { href: "/team", label: "Team" }]
    : BASE_LINKS;

  return (
    <div className="flex gap-5.5">
      {links.map((link) => {
        const active =
          link.href === "/dashboard"
            ? pathname.startsWith("/dashboard")
            : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`text-sm ${active ? "text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
