import "./globals.css";
import Link from "next/link";

export const metadata = { title: "Budget CIC" };

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/categories", label: "Catégories" },
  { href: "/settings", label: "Réglages" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
