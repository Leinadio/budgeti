import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
import { DetailSidebarProvider } from "@/components/detail-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";

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
        {/* La sidebar de detail (droite) englobe le shell : elle occupe sa propre
            colonne, donc l'en-tete et le contenu se retrecissent a son ouverture. */}
        <DetailSidebarProvider>
          {/* flex-1 min-w-0 : le shell de gauche est une colonne de la rangee
              exterieure ; sans lui il ne se retrecit pas quand le detail s'ouvre. */}
          <SidebarProvider className="min-w-0 flex-1">
            <AppSidebar />
            {/* min-w-0 : sans lui, un contenu large (grand tableau) empeche l'inset
                de retrecir sous sa taille min-content et deborde sous la sidebar. */}
            <SidebarInset className="min-w-0">
              <header className="flex items-center gap-2 border-b bg-card px-4 py-2">
                <SidebarTrigger />
              </header>
              <div className="px-6 py-6">{children}</div>
            </SidebarInset>
          </SidebarProvider>
        </DetailSidebarProvider>
      </body>
    </html>
  );
}
