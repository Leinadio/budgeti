import "./globals.css";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Budget CIC" };

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/previsionnel", label: "Prévisionnel" },
  { href: "/groupes", label: "Groupes" },
];

const themeScript =
  "document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <nav className="flex flex-wrap gap-1 border-b bg-card px-4 py-2">
          {NAV.map((n) => (
            <Button key={n.href} asChild variant="ghost" size="sm">
              <Link href={n.href}>{n.label}</Link>
            </Button>
          ))}
        </nav>
        <div className="flex">
          <aside className="w-48 shrink-0 border-r p-3">
            <Button asChild variant="ghost" size="sm">
              <Link href="/settings">Réglages</Link>
            </Button>
          </aside>
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
