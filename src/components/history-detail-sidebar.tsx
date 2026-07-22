"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellDetail, DetailNode, OverspendActionInfo, GroupManageInfo } from "@/lib/history-explain";
import { monthLabel } from "@/lib/transactions-view";
import {
  decideOverspend,
  undoOverspendDecision,
  renameGroupAction,
  deleteGroupAction,
  setGroupAmount,
  addGroupLine,
  editGroupLine,
  removeGroupLine,
} from "@/app/historique/actions";
import { Sidebar, SidebarHeader, SidebarContent } from "@/components/ui/sidebar";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

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
// cliquée est une Balance en dépassement. Deux boutons — « Exceptionnel » ou
// « Permanent » — enregistrent la décision en un clic, sans formulaire de budget.
function OverspendActionBlock({ action }: { action: OverspendActionInfo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState<"exceptional" | "permanent" | null>(action.decision);
  const decide = async (decision: "exceptional" | "permanent") => {
    setBusy(true);
    await decideOverspend(action.accountId, action.groupId, action.month, decision);
    setBusy(false);
    setDecided(decision);
    router.refresh();
  };
  const undo = async () => {
    setBusy(true);
    await undoOverspendDecision(action.accountId, action.groupId, action.month);
    setBusy(false);
    setDecided(null);
    router.refresh();
  };
  if (decided) {
    return (
      <div className="mt-4 rounded-md border p-3 text-sm">
        <p>
          Décidé : {decided === "exceptional" ? "exceptionnel" : "permanent"} pour le dépassement de{" "}
          {fmtAbs(action.amount)} en {monthLabel(action.month)}.
        </p>
        <div className="mt-2 flex gap-3">
          <button type="button" disabled={busy} onClick={() => setDecided(null)} className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:no-underline">
            Modifier
          </button>
          <button type="button" disabled={busy} onClick={undo} className="text-muted-foreground underline decoration-dotted underline-offset-2 hover:no-underline">
            Annuler
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-md border p-3 text-sm">
      <p>
        Dépassement de {fmtAbs(action.amount)} en {monthLabel(action.month)} — va-t-il revenir ?
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => decide("exceptional")} className="rounded-md border px-2 py-1 hover:bg-muted">
          Exceptionnel
        </button>
        <button type="button" disabled={busy} onClick={() => decide("permanent")} className="rounded-md border px-2 py-1 hover:bg-muted">
          Permanent
        </button>
      </div>
    </div>
  );
}

// Une ligne d'un récurrent en édition : nom / montant / jour, avec son propre état
// local (initialisé sur la ligne). « Enregistrer » applique editGroupLine, la
// corbeille supprime la ligne (removeGroupLine).
function LineRow({ line, busy, onSave, onRemove }: {
  line: { id: number; name: string; amount: number; day: number };
  busy: boolean;
  onSave: (name: string, amount: number, day: number) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(line.name);
  const [amount, setAmount] = useState(String(line.amount));
  const [day, setDay] = useState(String(line.day));
  return (
    <div className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label className="text-muted-foreground text-xs font-normal">Nom</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" />
      </div>
      <div className="flex w-20 flex-col gap-1">
        <Label className="text-muted-foreground text-xs font-normal">Montant</Label>
        <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8 text-right tabular-nums" />
      </div>
      <div className="flex w-14 flex-col gap-1">
        <Label className="text-muted-foreground text-xs font-normal">Jour</Label>
        <Input type="number" min="1" max="31" value={day} onChange={(e) => setDay(e.target.value)} className="h-8 text-right tabular-nums" />
      </div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={busy || !name.trim()}
        onClick={() => onSave(name.trim(), parseFloat(amount) || 0, parseInt(day, 10) || 1)}
      >
        Enregistrer
      </Button>
      <Button type="button" size="icon-xs" variant="ghost" disabled={busy} aria-label="Supprimer la ligne" onClick={onRemove}>
        <Trash2 className="text-muted-foreground size-4" />
      </Button>
    </div>
  );
}

// Vue de gestion d'un groupe (ouverte depuis l'icône au survol d'une ligne de
// groupe) : renommer, fixer le montant daté (enveloppe), gérer les lignes
// (récurrent) et supprimer le groupe. Chaque action revalide côté serveur ; on
// rafraîchit ensuite la vue pour refléter le changement.
function GroupManageBlock({ info, onClose }: { info: GroupManageInfo; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(info.name);
  const [amount, setAmount] = useState(() => String(info.currentAmount));
  const [scope, setScope] = useState<"ongoing" | "once">("ongoing");
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDay, setNewDay] = useState("1");
  // Liste des lignes affichée, en état local optimiste : `info.lines` est un
  // instantané capturé à l'ouverture du panneau, que router.refresh() ne met pas à
  // jour. On la maintient ici pour que l'ajout / la suppression se reflètent tout de
  // suite (la vraie valeur sera rechargée à la prochaine ouverture du panneau).
  const [lines, setLines] = useState(info.lines);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  };
  return (
    <>
      <SidebarHeader className="gap-0 border-b p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-muted-foreground text-sm">Gérer le groupe</p>
            <h2 className="font-semibold">{info.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Fermer">
            <X className="size-4" />
          </button>
        </div>
      </SidebarHeader>
      <SidebarContent className="space-y-6 p-4">
        {/* Renommer */}
        <div className="flex flex-col gap-2">
          <Label className="font-normal">Nom du groupe</Label>
          <div className="flex items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 flex-1" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !name.trim() || name.trim() === info.name}
              onClick={() => run(() => renameGroupAction(info.groupId, name))}
            >
              Renommer
            </Button>
          </div>
        </div>

        {/* Montant daté (enveloppe) */}
        {info.kind === "envelope" && (
          <div className="flex flex-col gap-2">
            <Label className="font-normal">Montant pour {monthLabel(info.month)}</Label>
            <div className="flex flex-wrap items-end gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 w-28 text-right tabular-nums"
              />
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as "ongoing" | "once")}
                className="h-9 rounded-md border bg-transparent px-2 text-sm"
              >
                <option value="ongoing">À partir de ce mois</option>
                <option value="once">Ce mois seulement</option>
              </select>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || !(parseFloat(amount) >= 0)}
                onClick={() => run(() => setGroupAmount(info.groupId, info.month, parseFloat(amount), scope))}
              >
                Appliquer
              </Button>
            </div>
          </div>
        )}

        {/* Lignes (récurrent) */}
        {info.kind === "recurring" && (
          <div className="flex flex-col gap-3">
            <Label className="font-normal">Lignes</Label>
            {lines.length === 0 && <p className="text-muted-foreground text-sm">Aucune ligne pour l&apos;instant.</p>}
            {lines.map((l) => (
              <LineRow
                key={l.id}
                line={l}
                busy={busy}
                onSave={(n, a, d) => run(() => editGroupLine(l.id, n, a, d))}
                onRemove={() =>
                  run(async () => {
                    await removeGroupLine(l.id);
                    setLines((cur) => cur.filter((x) => x.id !== l.id));
                  })
                }
              />
            ))}
            {/* Ajout d'une ligne */}
            <div className="mt-1 flex items-end gap-2 border-t pt-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Label className="text-muted-foreground text-xs font-normal">Nom</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8" placeholder="Ex: Spotify" />
              </div>
              <div className="flex w-20 flex-col gap-1">
                <Label className="text-muted-foreground text-xs font-normal">Montant</Label>
                <Input type="number" step="0.01" min="0" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className="h-8 text-right tabular-nums" placeholder="0.00" />
              </div>
              <div className="flex w-14 flex-col gap-1">
                <Label className="text-muted-foreground text-xs font-normal">Jour</Label>
                <Input type="number" min="1" max="31" value={newDay} onChange={(e) => setNewDay(e.target.value)} className="h-8 text-right tabular-nums" />
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || !newName.trim()}
                onClick={() =>
                  run(async () => {
                    const n = newName.trim();
                    const a = parseFloat(newAmount) || 0;
                    const d = parseInt(newDay, 10) || 1;
                    const id = await addGroupLine(info.groupId, n, a, d);
                    // On n'ajoute la ligne optimiste qu'avec le vrai id en base : sinon
                    // une suppression/édition immédiate (sans refermer le panneau)
                    // viserait un id fictif et laisserait une ligne fantôme en base.
                    if (id > 0) {
                      setLines((cur) => [...cur, { id, name: n, amount: a, day: d }]);
                    }
                    setNewName("");
                    setNewAmount("");
                    setNewDay("1");
                  })
                }
              >
                Ajouter
              </Button>
            </div>
          </div>
        )}

        {/* Suppression du groupe */}
        <div className="border-t pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="size-4" />
                Supprimer le groupe
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer ce groupe ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Le groupe sera supprimé et ses transactions repasseront en Non catégorisés.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={() =>
                    run(async () => {
                      await deleteGroupAction(info.groupId);
                      onClose();
                    })
                  }
                >
                  Supprimer
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SidebarContent>
    </>
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
  // Gestion d'un groupe : formulaires (renommer, montant, lignes, supprimer) au
  // lieu d'un calcul.
  if (detail.groupManage) {
    return <GroupManageBlock info={detail.groupManage} onClose={onClose} />;
  }
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
          key={`${detail.groupManage ? `manage:${detail.groupManage.groupId}:${detail.groupManage.month}` : ""}${detail.title}·${detail.subtitle ?? ""}·${detail.result}`}
          detail={detail}
          onClose={onClose}
          selectedPanel={selectedPanel}
          onSelectRow={onSelectRow}
        />
      )}
    </Sidebar>
  );
}
