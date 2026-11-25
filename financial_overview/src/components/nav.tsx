"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/login/actions";
import {
  ArrowLeftRight,
  LayoutDashboard,
  Settings,
  Wallet,
  Upload,
  LogOut,
} from "lucide-react";

const tabs = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/transactions", label: "Income & expenses", icon: ArrowLeftRight },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav({ signedIn = false }: { signedIn?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <nav className="flex flex-col gap-0.5 px-2 pb-4" aria-label="Main navigation">
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
        Import
      </Link>

      {signedIn && (
        <form action={logout} className="mt-auto pt-2">
          <button
            type="submit"
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <LogOut size={16} aria-hidden strokeWidth={1.8} />
            Sign out
          </button>
        </form>
      )}
    </nav>
  );
}
