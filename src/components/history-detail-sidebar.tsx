"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellDetail, OverspendActionInfo, GroupManageInfo, UncatProvisionInfo } from "@/lib/history-explain";
import { monthLabel, monthPhrase, deMonthPhrase, deMonthLabel } from "@/lib/transactions-view";
import { nextMonthKey } from "@/lib/history";
import { formatEur } from "@/lib/money";
import { detailKey } from "@/lib/history-detail";
import { flattenNodes, cellsForNode, cellsForTotal, TOTAL_ROW, type PanelRow } from "@/lib/history-nav";
import { amountAtMonth, type BudgetChange } from "@/lib/budget-history";
import {
  decideOverspend,
  undoOverspendDecision,
  renameGroupAction,
  deleteGroupAction,
  setGroupAmount,
  removeGroupAmount,
  setUncatProvision,
  addGroupLine,
  editGroupLine,
  removeGroupLine,
  removeLineAmount,
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

// Une ligne du tableau de détail : montant signé (opérateur + valeur absolue) à
// gauche, libellé (avec retrait et chevron dépliable) à droite. Cliquer la ligne
// la sélectionne (surbrillance ici et dans le grand tableau) si elle porte un ref ;
// sinon, si elle a des enfants, le clic la déplie.
function DetailRow({ row, selected, onToggle, onSelect }: {
  row: PanelRow;
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
// cliquée est une Balance en dépassement. « Exceptionnel » enregistre en un clic ;
// « Permanent » déplie un formulaire — un seul montant (budget ou provision) pour
// une enveloppe ou les non catégorisés, un montant par ligne en dépassement pour
// un récurrent (un récurrent n'a pas de budget à lui, voir action.overspentLines).
function OverspendActionBlock({ action }: { action: OverspendActionInfo }) {
  const router = useRouter();
  // Extrait pour que le null (« on ne sait pas ») se distingue proprement du
  // vide (« aucune ligne n'a dépassé ») dans tout ce qui suit, sans répéter
  // `action.overspentLines` à chaque branche.
  const { overspentLines } = action;
  const [openForm, setOpenForm] = useState(false);
  const [value, setValue] = useState(() => String(Math.round(((action.currentBudget ?? 0) + action.amount) * 100) / 100));
  // Montants saisis par ligne (formulaire « Permanent » d'un récurrent), indexés
  // par lineId. Non renseigné = pré-rempli au montant réellement dépensé.
  const [lineValues, setLineValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  // Le serveur peut refuser une décision « permanent » (canDecidePermanent : aucun
  // montant valide envoyé) : ce message ne s'affiche que dans ce cas, pour ne
  // jamais laisser croire qu'une décision a été prise quand ce n'est pas vrai. Il
  // ne doit pas non plus survivre à une correction : effacé dès que le formulaire
  // se referme ou qu'un champ change.
  const [error, setError] = useState<string | null>(null);
  // Décision affichée : celle déjà en base à l'ouverture, mise à jour tout de suite
  // après un choix pour que la question disparaisse sans attendre un nouveau clic —
  // mais seulement si le serveur a réellement enregistré la décision (decide) :
  // sinon l'écran annoncerait une décision qui n'a pas eu lieu.
  const [decided, setDecided] = useState<"exceptional" | "permanent" | null>(action.decision);
  const decide = async (
    decision: "exceptional" | "permanent",
    newBudget?: number,
    lineAmounts?: { lineId: number; amount: number }[],
  ) => {
    setBusy(true);
    setError(null);
    const ok = await decideOverspend(action.accountId, action.groupId, action.month, decision, newBudget, lineAmounts);
    setBusy(false);
    if (!ok) {
      // Le serveur ne dit pas pourquoi il a refusé (mois mal formé, ou aucun
      // montant valide) : on n'affirme que ce qui est toujours vrai.
      setError("La décision n'a pas été enregistrée.");
      return;
    }
    setOpenForm(false);
    setDecided(decision);
    router.refresh();
  };
  // Annule le choix en base : le dépassement redevient « à trancher » et, si c'était
  // « permanent », la hausse de budget/provision est retirée.
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
          {fmtAbs(action.amount)} en {monthPhrase(action.month)}.
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
        Dépassement de {fmtAbs(action.amount)} en {monthPhrase(action.month)} — va-t-il revenir ?
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy} onClick={() => decide("exceptional")} className="rounded-md border px-2 py-1 hover:bg-muted">
          Exceptionnel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpenForm((v) => !v);
            setError(null);
          }}
          className="rounded-md border px-2 py-1 hover:bg-muted"
        >
          Permanent
        </button>
      </div>
      {/* On ne sait pas : le mois du dépassement n'est pas dans la période
          affichée (une pastille peut viser un dépassement plus ancien que la
          fenêtre par défaut). Pas de données ici pour proposer un montant par
          ligne — plutôt que d'affirmer « aucune ligne n'a dépassé » sans le
          savoir, on dit à l'utilisateur comment retrouver ce mois. */}
      {openForm && overspentLines === null && (
        <p className="text-muted-foreground mt-2 text-sm">
          {monthLabel(action.month)} n&apos;est pas dans la période affichée : impossible
          de proposer un montant par ligne. Élargis la période au-dessus du tableau pour
          inclure ce mois, puis reviens choisir « Permanent ».
        </p>
      )}
      {/* Récurrent dont aucune ligne n'a dépassé ce mois-là : la dépense est
          rattachée au groupe, pas à une ligne précise — rien à ventiler ici, on
          renvoie vers l'édition des lignes plutôt que d'inventer une répartition. */}
      {openForm && overspentLines !== null && overspentLines.length === 0 && action.groupKind === "recurring" && (
        <p className="text-muted-foreground mt-2 text-sm">
          Aucune ligne n&apos;a dépassé en {monthPhrase(action.month)} : la dépense est
          rattachée au groupe, pas à une ligne précise. Ajuste la ligne concernée depuis
          « Gérer le groupe ».
        </p>
      )}
      {/* Récurrent : un montant par ligne en dépassement, pré-rempli au montant
          réellement dépensé, en vigueur à partir du mois qui suit le dépassement
          (celui du dépassement, pas le mois courant — affiché en clair pour ne
          pas laisser planer le doute). deMonthPhrase pose la préposition ET le
          mois : « à partir » + deMonthPhrase, jamais « à partir de » + monthLabel
          (sinon « de Août » — ni l'élision devant voyelle, ni la minuscule
          attendue en milieu de phrase). */}
      {openForm && overspentLines !== null && overspentLines.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted-foreground">
            Nouveaux montants, à partir {deMonthPhrase(nextMonthKey(action.month))} :
          </p>
          {overspentLines.map((l) => (
            <div key={l.lineId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{l.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground tabular-nums">{formatEur(l.budget)} →</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lineValues[l.lineId] ?? String(Math.round(l.spent * 100) / 100)}
                  onChange={(e) => {
                    setLineValues((v) => ({ ...v, [l.lineId]: e.target.value }));
                    setError(null);
                  }}
                  className="w-24 rounded-md border px-2 py-1 text-right tabular-nums"
                />
              </span>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            disabled={
              busy ||
              !overspentLines.some((l) => parseFloat(lineValues[l.lineId] ?? String(Math.round(l.spent * 100) / 100)) > 0)
            }
            onClick={() =>
              decide(
                "permanent",
                undefined,
                overspentLines.map((l) => ({
                  lineId: l.lineId,
                  amount: parseFloat(lineValues[l.lineId] ?? String(Math.round(l.spent * 100) / 100)),
                })),
              )
            }
          >
            Valider
          </Button>
        </div>
      )}
      {/* Enveloppe (ou non catégorisés) : un seul montant, comme avant. */}
      {openForm && overspentLines !== null && overspentLines.length === 0 && action.groupKind !== "recurring" && (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-muted-foreground" htmlFor="new-budget">
            {action.groupId === 0 ? "Nouvelle provision" : "Nouveau budget"}
          </label>
          <input
            id="new-budget"
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
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
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Vie d'un budget (enveloppe ou ligne) : ce qui s'applique et depuis quand. Le
// montant de départ se modifie mais ne se supprime pas — sans lui, l'un ou
// l'autre n'aurait plus de budget du tout, d'où l'absence de corbeille sur
// cette entrée (voir aussi canRemoveBudgetChange, revérifié côté serveur).
// Partagée entre le bloc « Vie du budget » d'une enveloppe et la liste sous
// chaque ligne d'un récurrent : mêmes libellés, même motif de corbeille
// conditionnelle, seule la taille du texte et de l'icône diffère entre les
// deux contextes.
function BudgetChangesList({ changes, busy, onRemoveChange, size = "sm" }: {
  changes: BudgetChange[];
  busy: boolean;
  onRemoveChange: (month: string) => void;
  size?: "sm" | "xs";
}) {
  if (changes.length === 0) return null;
  return (
    <ul className={cn("text-muted-foreground flex flex-col gap-1", size === "sm" ? "text-sm" : "text-xs")}>
      {changes.map((c) => (
        <li key={c.month} className="flex items-center justify-between gap-2">
          {/* Le libellé ouvre l'élément (comme « Montant de départ » à côté) :
              la majuscule de monthLabel y reste légitime, seule l'élision
              manquait — d'où deMonthLabel (garde la casse) et non deMonthPhrase
              (qui la mettrait en minuscule, hors de propos ici). */}
          <span>{c.isStart ? "Montant de départ" : `À partir ${deMonthLabel(c.month)}`}</span>
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{formatEur(c.amount)}</span>
            {!c.isStart && (
              <button
                type="button"
                disabled={busy}
                // Même correctif que le libellé ci-dessus (deMonthLabel, pas
                // deMonthPhrase) : ne change que l'élision manquante, pas la
                // casse — les mois qui ne demandent pas l'élision gardent
                // exactement le même texte qu'avant.
                aria-label={`Supprimer le changement ${deMonthLabel(c.month)}`}
                onClick={() => onRemoveChange(c.month)}
                className="text-muted-foreground hover:text-foreground"
              >
                <Trash2 className={size === "sm" ? "size-3.5" : "size-3"} />
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Une ligne d'un récurrent en édition : nom / montant du mois affiché / jour, plus
// la vie de son montant. Le nom et le jour valent pour tous les mois ; le montant
// est daté, avec la même portée que celle d'une enveloppe.
function LineRow({ line, busy, onSave, onRemove, onRemoveChange }: {
  line: { id: number; name: string; amount: number; day: number; changes: BudgetChange[] };
  busy: boolean;
  onSave: (name: string, day: number, amount: number, scope: "once" | "ongoing") => void;
  onRemove: () => void;
  onRemoveChange: (month: string) => void;
}) {
  const [name, setName] = useState(line.name);
  const [amount, setAmount] = useState(String(line.amount));
  const [day, setDay] = useState(String(line.day));
  const [scope, setScope] = useState<"ongoing" | "once">("ongoing");
  return (
    <div className="flex flex-col gap-2 border-b pb-3 last:border-b-0">
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
        <Button type="button" size="icon-xs" variant="ghost" disabled={busy} aria-label="Supprimer la ligne" onClick={onRemove}>
          <Trash2 className="text-muted-foreground size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as "ongoing" | "once")}
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="ongoing">À partir de ce mois</option>
          <option value="once">Ce mois seulement</option>
        </select>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !name.trim()}
          onClick={() => onSave(name.trim(), parseInt(day, 10) || 1, parseFloat(amount) || 0, scope)}
        >
          Enregistrer
        </Button>
      </div>
      <BudgetChangesList changes={line.changes} busy={busy} onRemoveChange={onRemoveChange} size="xs" />
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

        {/* Vie du budget : ce qui s'applique et depuis quand. */}
        {info.kind === "envelope" && info.changes.length > 0 && (
          <div className="flex flex-col gap-2">
            <Label className="font-normal">Vie du budget</Label>
            <BudgetChangesList
              changes={info.changes}
              busy={busy}
              onRemoveChange={(m) => run(() => removeGroupAmount(info.groupId, m))}
              size="sm"
            />
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
                line={{ ...l, amount: amountAtMonth(l.changes, info.month) }}
                busy={busy}
                onSave={(n, d, a, s) => run(() => editGroupLine(l.id, n, d, info.month, a, s))}
                onRemoveChange={(m) => run(() => removeLineAmount(l.id, m))}
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
                    const id = await addGroupLine(info.groupId, n, a, d, info.month);
                    // On n'ajoute la ligne optimiste qu'avec le vrai id en base : sinon
                    // une suppression/édition immédiate (sans refermer le panneau)
                    // viserait un id fictif et laisserait une ligne fantôme en base.
                    if (id > 0) {
                      setLines((cur) => [
                        ...cur,
                        { id, name: n, amount: a, day: d, changes: [{ month: info.month, amount: a, isStart: true }] },
                      ]);
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

// Vue d'édition de la provision des non catégorisés (ouverte depuis la case Budget
// dép. de la section non catégorisés) : fixe le montant daté du groupe 0, avec la
// même sémantique once/ongoing que le montant d'une enveloppe (voir
// GroupManageBlock ci-dessus). Pas de renommage, de lignes ni de suppression : le
// groupe 0 est un pseudo-groupe, pas une ligne de `groups`.
function UncatProvisionBlock({ info, onClose }: { info: UncatProvisionInfo; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(() => String(info.currentAmount));
  const [scope, setScope] = useState<"ongoing" | "once">("ongoing");
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
            <p className="text-muted-foreground text-sm">Non catégorisés</p>
            <h2 className="font-semibold">Provision pour {monthLabel(info.month)}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Fermer">
            <X className="size-4" />
          </button>
        </div>
      </SidebarHeader>
      <SidebarContent className="space-y-6 p-4">
        <div className="flex flex-col gap-2">
          <Label className="font-normal">Provision pour {monthLabel(info.month)}</Label>
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
              onClick={() => run(() => setUncatProvision(info.month, parseFloat(amount), scope))}
            >
              Appliquer
            </Button>
          </div>
        </div>
      </SidebarContent>
    </>
  );
}

// Corps du détail : monté sous une clé liée au détail (voir plus bas), de sorte que
// l'état de dépliage (open) repart de zéro à chaque nouveau montant cliqué.

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
  const rows = flattenNodes(detail.nodes, open);
  // Gestion d'un groupe : formulaires (renommer, montant, lignes, supprimer) au
  // lieu d'un calcul.
  if (detail.groupManage) {
    return <GroupManageBlock info={detail.groupManage} onClose={onClose} />;
  }
  // Édition de la provision des non catégorisés : formulaire (montant daté) au lieu
  // d'un calcul.
  if (detail.uncatProvision) {
    return <UncatProvisionBlock info={detail.uncatProvision} onClose={onClose} />;
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
              const cells = cellsForNode(r.node, detail.cellRef);
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
              const onTotal = onSelectRow ? () => onSelectRow(cellsForTotal(detail), TOTAL_ROW) : undefined;
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
          key={detailKey(detail)}
          detail={detail}
          onClose={onClose}
          selectedPanel={selectedPanel}
          onSelectRow={onSelectRow}
        />
      )}
    </Sidebar>
  );
}
