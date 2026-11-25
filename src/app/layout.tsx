import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/nav";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "FinancialOverview",
  description: "Persoonlijk overzicht van vermogen, inkomsten en uitgaven",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="nl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
          <aside className="shrink-0 border-border md:w-60 md:border-r">
            <div className="px-5 py-5">
              <span className="text-sm font-semibold tracking-tight">FinancialOverview</span>
            </div>
            <Nav />
          </aside>
          <main className="min-w-0 flex-1 px-5 py-6 md:px-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
