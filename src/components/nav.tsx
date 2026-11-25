"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight,
  LayoutDashboard,
  Settings,
  Wallet,
  Upload,
} from "lucide-react";

const tabs = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Inkomsten & uitgaven", icon: ArrowLeftRight },
  { href: "/accounts", label: "Rekeningen", icon: Wallet },
  { href: "/settings", label: "Instellingen", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="flex flex-col gap-0.5 px-2 pb-4" aria-label="Hoofdnavigatie">
      {tabs.map(({ href, label, icon: Icon }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors ${
              active
                ? "bg-surface-muted font-medium text-foreground"
                : "text-muted hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            <Icon size={16} aria-hidden strokeWidth={active ? 2.2 : 1.8} />
            {label}
          </Link>
        );
      })}
      <Link
        href="/import"
        className={`mt-2 flex h-9 items-center gap-2.5 rounded-md border border-border px-2.5 text-sm transition-colors hover:bg-surface-muted ${
          isActive("/import") ? "font-medium text-foreground" : "text-muted hover:text-foreground"
        }`}
      >
        <Upload size={16} aria-hidden strokeWidth={1.8} />
        Importeren
      </Link>
    </nav>
  );
}
