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
          <SidebarProvider className="h-svh min-w-0 flex-1 overflow-hidden">
            <AppSidebar />
            {/* min-w-0 : sans lui, un contenu large (grand tableau) empeche l'inset
                de retrecir sous sa taille min-content et deborde sous la sidebar.
                mr-0 quand le detail est ouvert : son p-2 fait deja l'ecart.
                overflow-hidden : clippe le contenu aux coins arrondis de la carte. */}
            <SidebarInset className="min-w-0 overflow-hidden md:group-data-[detail=open]/detail:mr-0">
              {/* shrink-0 : l'en-tete reste en place, c'est le contenu qui defile.
                  Pas de fond propre : il laisse voir celui de la carte. Avec bg-card
                  il etait de la meme couleur que le shell, ce qui masquait les coins
                  arrondis de la carte. */}
              <header className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
                <SidebarTrigger />
              </header>
              <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
            </SidebarInset>
          </SidebarProvider>
        </DetailSidebarProvider>
      </body>
    </html>
  );
}
