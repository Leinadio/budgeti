"use client";
import { useState } from "react";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellDetail, DetailNode } from "@/lib/history-explain";
import { Sidebar, SidebarHeader, SidebarContent } from "@/components/ui/sidebar";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAbs = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : Math.abs(n)).replace(/[  ]/g, " ");
const fmtSigned = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : n).replace(/[  ]/g, " ");
const opOf = (n: number) => (n < 0 ? "−" : "+");

// Une ligne de nœud : opérateur, montant (valeur absolue), libellé ; dépliable si children.
function NodeRow({ node, path, depth }: { node: DetailNode; path: string; depth: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = !!node.children && node.children.length > 0;
  return (
    <>
      <div
        className={cn("flex items-center gap-2 py-1 text-sm", hasChildren && "cursor-pointer")}
        style={{ paddingLeft: `${depth * 1.25}rem` }}
        onClick={hasChildren ? () => setOpen((o) => !o) : undefined}
      >
        <span className="w-3 shrink-0 text-muted-foreground">
          {hasChildren ? (open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />) : null}
        </span>
        <span className="w-4 shrink-0 text-center tabular-nums text-muted-foreground">{opOf(node.amount)}</span>
        <span className={cn("w-24 shrink-0 text-right tabular-nums", node.amount < 0 && "text-red-600")}>{fmtAbs(node.amount)}</span>
        <span className="min-w-0 flex-1 truncate">{node.label}</span>
      </div>
      {hasChildren && open && node.children!.map((c, i) => (
        <NodeRow key={`${path}.${i}`} node={c} path={`${path}.${i}`} depth={depth + 1} />
      ))}
    </>
  );
}

// Sidebar shadcn côté droit : elle pousse le contenu (comme la navigation de
// gauche) au lieu de le recouvrir. Le contenu affiché vient de `detail` ; le
// glissement (offcanvas) est piloté par le SidebarProvider qui l'englobe.
export function HistoryDetailSidebar({ detail, onClose }: { detail: CellDetail | null; onClose: () => void }) {
  return (
    <Sidebar side="right" variant="inset" collapsible="offcanvas">
      {detail && (
        <>
          <SidebarHeader className="gap-0 border-b p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="font-semibold">{detail.title}</h2>
                {detail.subtitle && <p className="text-muted-foreground text-sm">{detail.subtitle}</p>}
                <p className={cn("mt-1 text-lg font-semibold tabular-nums", detail.result < 0 && "text-red-600")}>{fmtSigned(detail.result)}</p>
              </div>
              <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Fermer">
                <X className="size-4" />
              </button>
            </div>
          </SidebarHeader>
          <SidebarContent className="p-4" key={`${detail.title}·${detail.subtitle ?? ""}·${detail.result}`}>
            <div>
              {detail.nodes.map((n, i) => (
                <NodeRow key={i} node={n} path={`${i}`} depth={0} />
              ))}
              <div className="mt-2 flex items-center gap-2 border-t pt-2 text-sm font-semibold">
                <span className="w-3 shrink-0" />
                <span className="w-4 shrink-0 text-center">=</span>
                <span className={cn("w-24 shrink-0 text-right tabular-nums", detail.result < 0 && "text-red-600")}>{fmtAbs(detail.result)}</span>
                <span className="min-w-0 flex-1 truncate">Total</span>
              </div>
              {detail.note && <p className="text-muted-foreground mt-3 text-xs">{detail.note}</p>}
            </div>
          </SidebarContent>
        </>
      )}
    </Sidebar>
  );
}
