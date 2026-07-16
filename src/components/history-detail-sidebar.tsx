"use client";
import { useState } from "react";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellDetail, DetailNode } from "@/lib/history-explain";
import { Sidebar, SidebarHeader, SidebarContent } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAbs = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : Math.abs(n)).replace(/[  ]/g, " ");
const fmtSigned = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : n).replace(/[  ]/g, " ");
const opOf = (n: number) => (n < 0 ? "−" : "+");
// Surbrillance d'une ligne sélectionnée : fond teinté + liseré d'accent à gauche
// rendu par une ombre interne (pas une bordure) pour ne pas décaler le tableau.
const HL =
  "bg-[color-mix(in_oklab,var(--primary)_18%,var(--background))] shadow-[inset_3px_0_0_0_var(--primary)]";

// Aplatit l'arbre de nœuds en lignes de tableau, en ne gardant que les enfants des
// nœuds dépliés (open). depth pilote le retrait ; path identifie la ligne.
type FlatRow = { node: DetailNode; path: string; depth: number; hasChildren: boolean; expanded: boolean };
function flatten(nodes: DetailNode[], open: Set<string>, depth = 0, prefix = ""): FlatRow[] {
  const out: FlatRow[] = [];
  nodes.forEach((n, i) => {
    const path = prefix ? `${prefix}.${i}` : `${i}`;
    const hasChildren = !!n.children && n.children.length > 0;
    const expanded = hasChildren && open.has(path);
    out.push({ node: n, path, depth, hasChildren, expanded });
    if (expanded) out.push(...flatten(n.children!, open, depth + 1, path));
  });
  return out;
}

// Une ligne du tableau de détail : montant signé (opérateur + valeur absolue) à
// gauche, libellé (avec retrait et chevron dépliable) à droite. Cliquer la ligne
// la sélectionne (surbrillance ici et dans le grand tableau) si elle porte un ref ;
// sinon, si elle a des enfants, le clic la déplie.
function DetailRow({ row, selected, onToggle, onSelect }: {
  row: FlatRow;
  selected: boolean;
  onToggle: () => void;
  onSelect?: () => void;
}) {
  const { node, depth, hasChildren, expanded } = row;
  const rowClick = onSelect ?? (hasChildren ? onToggle : undefined);
  return (
    <TableRow
      // data-selectable : marque les lignes qui pilotent la sélection. Un clic
      // ailleurs (hors de ces lignes) efface la surbrillance (voir DetailSidebarProvider).
      data-selectable={onSelect ? "" : undefined}
      className={cn(selected && HL, rowClick && "cursor-pointer")}
      onClick={rowClick}
    >
      <TableCell className="w-px py-1 pr-3 text-right align-top whitespace-nowrap tabular-nums">
        <span className="text-muted-foreground mr-1">{opOf(node.amount)}</span>
        <span className={cn(node.amount < 0 && "text-red-600")}>{fmtAbs(node.amount)}</span>
      </TableCell>
      <TableCell className="w-full py-1 align-top">
        <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 1}rem` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="text-muted-foreground shrink-0"
              aria-label={expanded ? "Replier" : "Déplier"}
            >
              {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            </button>
          ) : (
            <span className="inline-block size-3 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{node.label}</span>
        </div>
      </TableCell>
    </TableRow>
  );
}

// Corps du détail : monté sous une clé liée au détail (voir plus bas), de sorte que
// l'état de dépliage (open) repart de zéro à chaque nouveau montant cliqué.
function DetailBody({ detail, onClose, selected, onSelectRef }: {
  detail: CellDetail;
  onClose: () => void;
  selected?: string | null;
  onSelectRef?: (ref: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (p: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const rows = flatten(detail.nodes, open);
  return (
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
      <SidebarContent className="p-4">
        <Table>
          <TableBody>
            {rows.map((r) => {
              const ref = r.node.ref;
              return (
                <DetailRow
                  key={r.path}
                  row={r}
                  selected={!!ref && selected === ref}
                  onToggle={() => toggle(r.path)}
                  onSelect={ref && onSelectRef ? () => onSelectRef(ref) : undefined}
                />
              );
            })}
            {(() => {
              // Le total correspond à la case du tableau qui a ouvert ce détail
              // (cellRef) : la cliquer surligne cette case comme n'importe quelle ligne.
              const onTotal = detail.cellRef && onSelectRef ? () => onSelectRef(detail.cellRef!) : undefined;
              const totalSelected = detail.cellRef != null && selected === detail.cellRef;
              return (
                <TableRow
                  data-selectable={onTotal ? "" : undefined}
                  className={cn("border-t font-semibold", totalSelected ? HL : "hover:bg-transparent", onTotal && "cursor-pointer")}
                  onClick={onTotal}
                >
                  <TableCell className="w-px py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                    <span className="text-muted-foreground mr-1">=</span>
                    <span className={cn(detail.result < 0 && "text-red-600")}>{fmtAbs(detail.result)}</span>
                  </TableCell>
                  <TableCell className="w-full py-2">Total</TableCell>
                </TableRow>
              );
            })()}
          </TableBody>
        </Table>
        {detail.note && <p className="text-muted-foreground mt-3 text-xs">{detail.note}</p>}
      </SidebarContent>
    </>
  );
}

// Sidebar shadcn côté droit : elle pousse le contenu (comme la navigation de
// gauche) au lieu de le recouvrir. Le contenu affiché vient de `detail` ; le
// glissement (offcanvas) est piloté par le SidebarProvider qui l'englobe. La clé
// sur DetailBody réinitialise son état de dépliage à chaque nouveau détail.
export function HistoryDetailSidebar({ detail, onClose, selected, onSelectRef }: {
  detail: CellDetail | null;
  onClose: () => void;
  selected?: string | null;
  onSelectRef?: (ref: string) => void;
}) {
  return (
    <Sidebar side="right" variant="inset" collapsible="offcanvas">
      {detail && (
        <DetailBody
          key={`${detail.title}·${detail.subtitle ?? ""}·${detail.result}`}
          detail={detail}
          onClose={onClose}
          selected={selected}
          onSelectRef={onSelectRef}
        />
      )}
    </Sidebar>
  );
}
