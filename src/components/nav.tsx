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
    <nav className="flex flex-col gap-1 px-3 py-4" aria-label="Hoofdnavigatie">
      {tabs.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
            isActive(href)
              ? "bg-foreground/10 font-medium text-foreground"
              : "text-muted hover:bg-foreground/5 hover:text-foreground"
          }`}
        >
          <Icon size={16} aria-hidden />
          {label}
        </Link>
      ))}
      <Link
        href="/import"
        className={`mt-2 flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-foreground/5 ${
          isActive("/import") ? "font-medium" : "text-muted hover:text-foreground"
        }`}
      >
        <Upload size={16} aria-hidden />
        Importeren
      </Link>
    </nav>
  );
}
