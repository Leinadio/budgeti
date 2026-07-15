"use client";
import { createContext, useContext, useState } from "react";
import type { CellDetail } from "@/lib/history-explain";
import { SidebarProvider } from "@/components/ui/sidebar";
import { HistoryDetailSidebar } from "@/components/history-detail-sidebar";

type Ctx = { detail: CellDetail | null; setDetail: (d: CellDetail | null) => void };
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
  const [detail, setDetail] = useState<CellDetail | null>(null);
  return (
    <DetailSidebarContext.Provider value={{ detail, setDetail }}>
      <SidebarProvider
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        // group/detail + data-detail : le contenu (SidebarInset) doit coller a la
        // sidebar de detail quand elle est ouverte (son p-2 fait deja l'ecart).
        // shadcn ne gere ce reglage que pour une sidebar de gauche, via un
        // selecteur `peer` qui ne remonte pas jusqu'a une sidebar placee apres.
        className="group/detail"
        data-detail={detail ? "open" : "closed"}
        style={{ "--sidebar-width": "26rem" } as React.CSSProperties}
      >
        {children}
        <HistoryDetailSidebar detail={detail} onClose={() => setDetail(null)} />
      </SidebarProvider>
    </DetailSidebarContext.Provider>
  );
}
