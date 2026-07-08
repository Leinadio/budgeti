"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/previsionnel", label: "Prévisionnel" },
  { href: "/groupes", label: "Groupes" },
];

export function TopNav() {
  const pathname = usePathname();
  return (
    <>
      {NAV.map((n) => {
        const active = pathname === n.href;
        return (
          <Button key={n.href} asChild variant={active ? "secondary" : "ghost"} size="sm">
            <Link href={n.href}>{n.label}</Link>
          </Button>
        );
      })}
    </>
  );
}
