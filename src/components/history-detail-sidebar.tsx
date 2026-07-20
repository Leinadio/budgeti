"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellDetail, DetailNode, OverspendActionInfo } from "@/lib/history-explain";
import { monthLabel } from "@/lib/transactions-view";
import { decideOverspend } from "@/app/historique/actions";
import { Sidebar, SidebarHeader, SidebarContent } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtAbs = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : Math.abs(n)).replace(/[  ]/g, " ");
const fmtSigned = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : n).replace(/[  ]/g, " ");
const opOf = (n: number) => (n < 0 ? "−" : "+");
// Surbrillance d'une ligne sélectionnée : fond foncé + liseré d'accent à gauche
// rendu par une ombre interne (pas une bordure) pour ne pas décaler le tableau.
// On fixe aussi la couleur au survol (hover:) sur la même teinte foncée, sinon le
// hover:bg-muted/50 de la TableRow l'éclaircirait au passage de la souris.
const HL =
  "bg-[color-mix(in_oklab,var(--primary)_18%,var(--background))] hover:bg-[color-mix(in_oklab,var(--primary)_18%,var(--background))] shadow-[inset_3px_0_0_0_var(--primary)]";

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

// Bloc de décision d'un dépassement : affiché sous le détail quand la case
// cliquée est une Balance en dépassement. « Exceptionnel » enregistre en un
// clic ; « Permanent » déplie un mini-formulaire avec le nouveau budget
// pré-rempli (budget + dépassement), ajustable avant validation.
function OverspendActionBlock({ action }: { action: OverspendActionInfo }) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [value, setValue] = useState(() => String(Math.round(((action.currentBudget ?? 0) + action.amount) * 100) / 100));
  const [busy, setBusy] = useState(false);
  // Décision affichée : celle déjà en base à l'ouverture, mise à jour tout de suite
  // après un choix pour que la question disparaisse sans attendre un nouveau clic.
  const [decided, setDecided] = useState<"exceptional" | "permanent" | null>(action.decision);
  const decide = async (decision: "exceptional" | "permanent", newBudget?: number) => {
    setBusy(true);
    await decideOverspend(action.accountId, action.groupId, action.month, decision, newBudget);
    setBusy(false);
    setOpenForm(false);
    setDecided(decision);
    router.refresh();
  };
  // Une fois tranché : on masque la question et les boutons, on montre le choix, avec
  // la possibilité de le modifier.
  if (decided) {
    return (
      <div className="mt-4 rounded-md border p-3 text-sm">
        <p>
          Décidé : {decided === "exceptional" ? "exceptionnel" : "permanent"} pour le dépassement de{" "}
          {fmtAbs(action.amount)} en {monthLabel(action.month)}.
        </p>
        <button type="button" onClick={() => setDecided(null)} className="text-muted-foreground mt-2 underline decoration-dotted underline-offset-2 hover:no-underline">
          Modifier
        </button>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-md border p-3 text-sm">
      <p>
        Dépassement de {fmtAbs(action.amount)} en {monthLabel(action.month)} — que veux-tu en faire ?
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => decide("exceptional")} className="rounded-md border px-2 py-1 hover:bg-muted">
          Exceptionnel
        </button>
        {action.currentBudget != null && (
          <button type="button" disabled={busy} onClick={() => setOpenForm((v) => !v)} className="rounded-md border px-2 py-1 hover:bg-muted">
            Permanent
          </button>
        )}
      </div>
      {openForm && action.currentBudget != null && (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-muted-foreground" htmlFor="new-budget">Nouveau budget</label>
          <input
            id="new-budget"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-24 rounded-md border px-2 py-1 text-right tabular-nums"
          />
          <button
            type="button"
            disabled={busy || !(parseFloat(value) > 0)}
            onClick={() => decide("permanent", parseFloat(value))}
            className="bg-primary text-primary-foreground rounded-md px-2 py-1"
          >
            Valider
          </button>
        </div>
      )}
    </div>
  );
}

// Corps du détail : monté sous une clé liée au détail (voir plus bas), de sorte que
// l'état de dépliage (open) repart de zéro à chaque nouveau montant cliqué.
// Identité de la ligne « Total » du panneau (distincte des chemins de nœuds « 0.1 »).
const TOTAL_ROW = "__total__";

function DetailBody({ detail, onClose, selectedPanel, onSelectRow }: {
  detail: CellDetail;
  onClose: () => void;
  // Ligne du panneau actuellement active (identité propre : chemin de nœud ou TOTAL_ROW).
  selectedPanel?: string | null;
  // Sélection : (cases du tableau à surligner | null, identité de la ligne du panneau).
  // Plusieurs cases quand la ligne est une somme éclatée dans le tableau.
  onSelectRow?: (cells: string[] | null, panel: string) => void;
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
  // Explication de colonne : titre + paragraphes de texte, sans chiffre ni calcul.
  if (detail.description) {
    return (
      <>
        <SidebarHeader className="gap-0 border-b p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-muted-foreground text-sm">Colonne</p>
              <h2 className="font-semibold">{detail.title}</h2>
            </div>
            <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Fermer">
              <X className="size-4" />
            </button>
          </div>
        </SidebarHeader>
        <SidebarContent className="p-4">
          <div className="space-y-3 text-sm leading-relaxed">
            {detail.description.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </SidebarContent>
      </>
    );
  }
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
              // Toute ligne est cliquable et surligne une ou plusieurs cases du
              // tableau : ses cases dédiées (refs) si son montant est une somme
              // éclatée dans le tableau, sinon sa case (ref), sinon la case d'origine
              // du détail (celle dont on montre le calcul). La ligne active du panneau
              // est identifiée par son propre chemin (r.path), donc cliquer une ligne
              // n'active jamais aussi la ligne « Total » — même si elles surlignent la
              // même case du tableau.
              const cells =
                r.node.refs ?? (r.node.ref ? [r.node.ref] : detail.cellRef ? [detail.cellRef] : null);
              return (
                <DetailRow
                  key={r.path}
                  row={r}
                  selected={selectedPanel === r.path}
                  onToggle={() => toggle(r.path)}
                  onSelect={onSelectRow ? () => onSelectRow(cells, r.path) : undefined}
                />
              );
            })}
            {(() => {
              // Le total correspond à la case du tableau qui a ouvert ce détail
              // (cellRef) : la cliquer surligne cette case. Identité propre (TOTAL_ROW)
              // pour n'activer que cette ligne.
              const onTotal = onSelectRow ? () => onSelectRow(detail.cellRef ? [detail.cellRef] : null, TOTAL_ROW) : undefined;
              const totalSelected = selectedPanel === TOTAL_ROW;
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
        {detail.overspendAction && <OverspendActionBlock action={detail.overspendAction} />}
        {detail.note && <p className="text-muted-foreground mt-3 text-xs">{detail.note}</p>}
      </SidebarContent>
    </>
  );
}

// Sidebar shadcn côté droit : elle pousse le contenu (comme la navigation de
// gauche) au lieu de le recouvrir. Le contenu affiché vient de `detail` ; le
// glissement (offcanvas) est piloté par le SidebarProvider qui l'englobe. La clé
// sur DetailBody réinitialise son état de dépliage à chaque nouveau détail.
export function HistoryDetailSidebar({ detail, onClose, selectedPanel, onSelectRow }: {
  detail: CellDetail | null;
  onClose: () => void;
  selectedPanel?: string | null;
  onSelectRow?: (cells: string[] | null, panel: string) => void;
}) {
  return (
    <Sidebar side="right" variant="inset" collapsible="offcanvas">
      {detail && (
        <DetailBody
          key={`${detail.title}·${detail.subtitle ?? ""}·${detail.result}`}
          detail={detail}
          onClose={onClose}
          selectedPanel={selectedPanel}
          onSelectRow={onSelectRow}
        />
      )}
    </Sidebar>
  );
}
