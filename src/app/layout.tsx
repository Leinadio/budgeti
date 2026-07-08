import "./globals.css";
import Link from "next/link";
import { TopNav } from "@/components/top-nav";
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
              <TopNav />
            </nav>
            <div className="px-6 py-6">{children}</div>
          </SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  );
}
