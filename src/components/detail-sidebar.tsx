"use client";
import { createContext, useContext, useEffect, useState } from "react";
import type { CellDetail } from "@/lib/history-explain";
import { SidebarProvider } from "@/components/ui/sidebar";
import { HistoryDetailSidebar } from "@/components/history-detail-sidebar";

// selected : clé de la case du tableau à surligner, choisie depuis le side panel.
type Ctx = {
  detail: CellDetail | null;
  setDetail: (d: CellDetail | null) => void;
  selected: string | null;
  setSelected: (r: string | null) => void;
};
const DetailSidebarContext = createContext<Ctx | null>(null);

export function useDetailSidebar(): Ctx {
  const ctx = useContext(DetailSidebarContext);
  if (!ctx) throw new Error("useDetailSidebar doit être utilisé dans <DetailSidebarProvider>");
  return ctx;
}

// Sidebar de détail (à droite) montée au niveau du shell, comme la navigation de
// gauche : elle occupe sa propre colonne, donc l'en-tête et le contenu se
// rétrécissent quand elle s'ouvre. Montée dans la page, le panneau (toujours
// `fixed` sur toute la hauteur) passerait par-dessus l'en-tête et ressemblerait
// à un Sheet.
//
// Deux SidebarProvider imbriqués : shadcn n'a qu'un état par provider, il en
// faut donc un par sidebar. Celui-ci est l'extérieur (il englobe le shell de
// gauche) et il est piloté par la sélection : ouvert quand un montant est
// sélectionné, fermé sinon. Le SidebarTrigger de l'en-tête, rendu à l'intérieur
// du provider de gauche, continue de piloter la navigation.
export function DetailSidebarProvider({ children }: { children: React.ReactNode }) {
  const [detail, setDetailState] = useState<CellDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Ouvrir un nouveau détail réinitialise la sélection de ligne : la surbrillance
  // n'a de sens que dans le contexte du détail affiché.
  const setDetail = (d: CellDetail | null) => {
    setDetailState(d);
    setSelected(null);
  };
  // Cliquer en dehors d'une ligne sélectionnable du side panel efface la
  // surbrillance (dans le panel et dans le tableau). On écoute au niveau du
  // document : un clic sur une ligne `data-selectable` (re)pose la sélection via
  // son propre onClick, donc on ne l'efface pas ; tout autre clic la retire.
  useEffect(() => {
    if (selected == null) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest("[data-selectable]")) return;
      setSelected(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selected]);
  return (
    <DetailSidebarContext.Provider value={{ detail, setDetail, selected, setSelected }}>
      <SidebarProvider
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        // group/detail + data-detail : le contenu (SidebarInset) doit coller a la
        // sidebar de detail quand elle est ouverte (son p-2 fait deja l'ecart).
        // shadcn ne gere ce reglage que pour une sidebar de gauche, via un
        // selecteur `peer` qui ne remonte pas jusqu'a une sidebar placee apres.
        // h-svh + overflow-hidden : le shell tient dans l'ecran et ne defile pas.
        // C'est le contenu de la carte qui defile (voir layout), donc l'en-tete
        // reste en place et les coins arrondis restent visibles.
        className="group/detail h-svh overflow-hidden"
        data-detail={detail ? "open" : "closed"}
        style={{ "--sidebar-width": "26rem" } as React.CSSProperties}
      >
        {children}
        <HistoryDetailSidebar
          detail={detail}
          onClose={() => setDetail(null)}
          selected={selected}
          onSelectRef={setSelected}
        />
      </SidebarProvider>
    </DetailSidebarContext.Provider>
  );
}
