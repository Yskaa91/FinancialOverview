import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

// "Financial Trust" pairing from the ui-ux-pro-max typography data: one sans for
// prose, one mono for figures and codes.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "FinancialOverview",
  description: "Personal overview of wealth, income and expenses",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
          <aside className="shrink-0 border-border md:w-60 md:border-r">
            <div className="flex h-14 items-center px-4">
              <span className="text-sm font-semibold tracking-tight">FinancialOverview</span>
            </div>
            <Nav />
          </aside>
          <main id="main" className="min-w-0 flex-1 px-4 py-5 md:px-6">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
