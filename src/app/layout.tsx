import "./globals.css";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { AppSidebar } from "@/components/app-sidebar";
import { DetailSidebarProvider } from "@/components/detail-sidebar";
import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar";
import { NotificationsButton } from "@/components/notifications-button";
import { appNotifications } from "@/lib/app-notifications";

export const metadata = { title: "Budget CIC" };

// Trois fontes, trois rôles, une seule idée : l'app se lit comme un relevé de
// compte imprimé. next/font les télécharge à la construction et les sert depuis
// l'app — aucun appel réseau à l'exécution, ce qui compte pour une app locale.
//
// Fraunces, en display, uniquement sur les noms de mois et les titres de compte :
// une serif à fort contraste qui donne aux mois un statut de titre de chapitre.
// Employée avec parcimonie, elle ne touche jamais une donnée.
const display = Fraunces({
  subsets: ["latin"],
  axes: ["SOFT", "opsz"],
  display: "swap",
  // Nom distinct du jeton Tailwind --font-display, sinon la variable de thème
  // se référencerait elle-même.
  variable: "--font-display-vf",
});

// IBM Plex Sans pour l'interface : dessinée pour la donnée, elle s'accorde
// nativement avec sa mono (mêmes proportions), et ce n'est ni Inter ni la pile
// système par défaut.
const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-sans-ui",
});

// IBM Plex Mono pour TOUT ce qui est chiffre. C'est le pari de la refonte :
// une chasse fixe fait que la virgule, les centimes et les milliers tombent au
// même endroit d'une ligne à l'autre. Une colonne de montants se lit alors
// verticalement, d'un coup d'œil, comme sur un relevé papier.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-num",
});

const themeScript =
  "document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)";

// Rendu à chaque navigation : les notifications se recalculent avec la base, sans quoi
// un dépassement corrigé resterait affiché.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const notifications = appNotifications();
  return (
    <html
      lang="fr"
      suppressHydrationWarning
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
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
                {/* ml-auto : le bouton se pose à droite de l'en-tête, à l'opposé de
                    l'ouverture du menu. */}
                <div className="ml-auto">
                  <NotificationsButton items={notifications} />
                </div>
              </header>
              <div className="flex-1 overflow-y-auto px-6 py-6">{children}</div>
            </SidebarInset>
          </SidebarProvider>
        </DetailSidebarProvider>
      </body>
    </html>
  );
}
