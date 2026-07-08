import "./globals.css";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";

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
        <SidebarProvider>
          <Sidebar>
            <SidebarHeader className="px-3 py-2 text-sm font-semibold">Budget CIC</SidebarHeader>
            <SidebarContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <Link href="/settings">Réglages</Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarContent>
          </Sidebar>
          <SidebarInset>
            <nav className="flex flex-wrap items-center gap-1 border-b bg-card px-4 py-2">
              <SidebarTrigger />
              {NAV.map((n) => (
                <Button key={n.href} asChild variant="ghost" size="sm">
                  <Link href={n.href}>{n.label}</Link>
                </Button>
              ))}
            </nav>
            <div className="px-6 py-6">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  );
}
