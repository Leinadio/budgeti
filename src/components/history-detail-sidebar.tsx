"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { closedOverspendText, type CellDetail, type OverspendActionInfo, type GroupManageInfo, type LineManageInfo, type UncatProvisionInfo, type BudgetEditInfo } from "@/lib/history-explain";
import { monthLabel, monthPhrase, deMonthPhrase } from "@/lib/transactions-view";
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
  setUncatProvision,
  addGroupLine,
  editGroupLine,
  removeGroupLine,
  setGroupLineAmount,
  spreadGroupAmount,
  spreadGroupLineAmount,
  spreadUncatProvision,
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

// Bloc de décision d'un dépassement : affiché sous le détail quand la case cliquée est
// une Balance en dépassement. « Exceptionnel » enregistre en un clic ; « Permanent »
// déplie un champ, un seul montant.
//
// Un seul montant partout, désormais : on ne tranche plus que ce qui PORTE un budget —
// une enveloppe, les non catégorisés, ou une ligne de récurrent. Le groupe d'un
// récurrent n'en porte pas (son budget est la somme de ses lignes) et n'est donc jamais
// décidable. C'est ce qui a fait disparaître l'ancien formulaire de ventilation, où il
// fallait répartir à la main un dépassement de groupe entre ses lignes.
function OverspendActionBlock({ action }: { action: OverspendActionInfo }) {
  const router = useRouter();
  const [openForm, setOpenForm] = useState(false);
  const [value, setValue] = useState(() => String(Math.round(((action.currentBudget ?? 0) + action.amount) * 100) / 100));
  const [busy, setBusy] = useState(false);
  // Le serveur peut refuser une décision (montant invalide, mois clos, groupe non
  // décidable) : ce message ne s'affiche que dans ce cas, pour ne jamais laisser croire
  // qu'une décision a été prise quand ce n'est pas vrai. Il ne doit pas non plus
  // survivre à une correction : effacé dès que le formulaire se referme ou qu'un champ
  // change.
  const [error, setError] = useState<string | null>(null);
  // Décision affichée : celle déjà en base à l'ouverture, mise à jour tout de suite
  // après un choix pour que la question disparaisse sans attendre un nouveau clic —
  // mais seulement si le serveur a réellement enregistré la décision (decide) :
  // sinon l'écran annoncerait une décision qui n'a pas eu lieu.
  const [decided, setDecided] = useState<"exceptional" | "permanent" | null>(action.decision);
  const decide = async (decision: "exceptional" | "permanent", newBudget?: number) => {
    setBusy(true);
    setError(null);
    const ok = await decideOverspend(action.accountId, action.groupId, action.lineId, action.month, decision, newBudget);
    setBusy(false);
    if (!ok) {
      // Le serveur ne dit pas pourquoi il a refusé : on n'affirme que ce qui est
      // toujours vrai.
      setError("La décision n'a pas été enregistrée.");
      return;
    }
    setOpenForm(false);
    setDecided(decision);
    router.refresh();
  };
  // Annule le choix en base : le dépassement redevient « à trancher » et, si c'était
  // « permanent », la hausse de budget est retirée.
  const undo = async () => {
    setBusy(true);
    await undoOverspendDecision(action.accountId, action.groupId, action.lineId, action.month);
    setBusy(false);
    setDecided(null);
    router.refresh();
  };
  // Mois clos : rien à trancher, rien à défaire. On ne montre que ce qui s'applique —
  // la décision prise en son temps, ou l'exceptionnel d'office quand rien n'a été
  // tranché. Le serveur refuse de toute façon les deux actions : ce n'est pas qu'un
  // masquage.
  if (action.closed) {
    return (
      <div className="mt-4 rounded-md border p-3 text-muted-foreground text-sm">
        <p>{closedOverspendText(action.decision, fmtAbs(action.amount), monthPhrase(action.month))}</p>
      </div>
    );
  }
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
      {/* Le budget en vigueur est affiché À CÔTÉ du montant proposé, et le mois d'effet
          en clair au-dessus. Sans ça, le champ n'affichait qu'un nombre — le budget PLUS
          le dépassement — qui ne correspondait à aucun montant existant : on croyait lire
          le budget actuel et on lisait la proposition. */}
      {openForm && (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-muted-foreground">
            Nouveau montant, à partir {deMonthPhrase(nextMonthKey(action.month))} :
          </p>
          <div className="flex items-center gap-2">
            <label className="text-muted-foreground" htmlFor="new-budget">
              {action.groupId === 0 ? "Provision" : "Budget"}
            </label>
            {action.currentBudget != null && (
              <span className="text-muted-foreground tabular-nums">{formatEur(action.currentBudget)} →</span>
            )}
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
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}

// Vue de gestion d'une ligne de récurrent, ouverte par le crayon au survol de la
// ligne dans le tableau. Son nom et son jour, les deux seules propriétés qui valent
// pour tous les mois, et sa suppression. Aucun montant : il est daté et se fixe depuis
// la case « Budget dép. » de la ligne, au mois de la colonne — exactement comme pour
// une enveloppe, et pour la même raison (voir BudgetEditBlock).
function LineManageBlock({ info, onClose }: { info: LineManageInfo; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(info.name);
  const [day, setDay] = useState(String(info.day));
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
            <p className="text-muted-foreground text-sm">Gérer la ligne</p>
            <h2 className="font-semibold">{info.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0 rounded p-1" aria-label="Fermer">
            <X className="size-4" />
          </button>
        </div>
      </SidebarHeader>
      <SidebarContent className="space-y-6 p-4">
        <div className="flex flex-col gap-2">
          <Label className="font-normal">Nom de la ligne</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="font-normal">Jour du mois</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min="1" max="31" value={day} onChange={(e) => setDay(e.target.value)} className="h-9 w-20 text-right tabular-nums" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !name.trim() || (name.trim() === info.name && day === String(info.day))}
              onClick={() => run(() => editGroupLine(info.lineId, name.trim(), parseInt(day, 10) || 1))}
            >
              Enregistrer
            </Button>
          </div>
        </div>
        <div className="border-t pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" size="sm" variant="ghost" disabled={busy} className="text-red-600 hover:text-red-700">
                <Trash2 className="size-4" />
                Supprimer la ligne
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Supprimer cette ligne ?</AlertDialogTitle>
                <AlertDialogDescription>
                  La ligne et tous ses montants seront supprimés du groupe.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 text-white hover:bg-red-700"
                  onClick={() =>
                    run(async () => {
                      await removeGroupLine(info.lineId);
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

// Bloc d'édition d'un budget, affiché sous la décomposition de sa case « Budget dép. ».
// C'est le seul endroit d'où un montant se modifie : la case dit le mois, et un montant
// n'a de sens qu'attaché à un mois.
//
// On ne demande plus la portée AVANT de saisir. « Appliquer » vaut pour le seul mois
// cliqué, puis la question tombe : les mois suivants doivent-ils prendre ce montant ?
// Répondre après plutôt qu'avant, c'est répondre en voyant le montant qu'on vient de
// poser, et non un choix abstrait à faire de tête au moment de la saisie.
//
// Ne s'affiche jamais sur un mois clos ni sur un groupe récurrent : budgetEditOfGroup /
// budgetEditOfLine rendent alors null et la case n'a pas de bloc du tout.
function BudgetEditBlock({ info }: { info: BudgetEditInfo }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // Montant en vigueur au mois cliqué, resynchronisé sur ce que le serveur vient
  // réellement de poser : recalculer la sémantique des portées côté client
  // dupliquerait la règle de lecture, avec le risque de diverger.
  const [changes, setChanges] = useState(info.changes);
  const enForce = amountAtMonth(changes, info.month);
  const [amount, setAmount] = useState(String(enForce));
  // Montant tout juste appliqué : tant qu'il est là, on pose la question de la
  // propagation. null = rien à demander (rien appliqué, ou déjà répondu).
  const [applique, setApplique] = useState<number | null>(null);
  // Resynchronisation pendant le rendu, pas un useEffect (react.dev/learn/
  // you-might-not-need-an-effect) : le champ doit suivre le montant en vigueur après
  // un « Appliquer », sans que ce composant soit remonté.
  const [prevEnForce, setPrevEnForce] = useState(enForce);
  if (prevEnForce !== enForce) {
    setPrevEnForce(enForce);
    setAmount(String(enForce));
  }
  const run = async (fn: () => Promise<BudgetChange[]>) => {
    setBusy(true);
    const next = await fn();
    setBusy(false);
    setChanges(next);
    router.refresh();
  };
  const saisi = parseFloat(amount);
  const apply = async () => {
    await run(() =>
      info.target === "group"
        ? setGroupAmount(info.id, info.month, saisi, "once")
        : setGroupLineAmount(info.id, info.month, saisi, "once"),
    );
    setApplique(saisi);
  };
  const propager = async () => {
    await run(() =>
      info.target === "group"
        ? spreadGroupAmount(info.id, info.month, applique!)
        : spreadGroupLineAmount(info.id, info.month, applique!),
    );
    setApplique(null);
  };
  return (
    <div className="mt-4 flex flex-col gap-4 border-t pt-4">
      <div className="flex flex-col gap-2">
        <Label className="font-normal">Montant pour {monthLabel(info.month)}</Label>
        <div className="flex flex-wrap items-end gap-2">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              // Modifier le champ rouvre la saisie : la question porterait sinon sur un
              // montant qui n'est plus celui affiché.
              setApplique(null);
            }}
            className="h-9 w-28 text-right tabular-nums"
          />
          <Button type="button" size="sm" variant="secondary" disabled={busy || !(saisi >= 0)} onClick={apply}>
            Appliquer
          </Button>
        </div>
      </div>
      {applique !== null && (
        <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
          <p>
            {formatEur(applique)} appliqué à {monthLabel(info.month)}. Les mois suivants
            doivent-ils prendre ce montant ?
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Le libellé dit la conséquence : répondre oui remplace les montants déjà
                prévus après ce mois, il ne se contente pas de combler les vides. */}
            <Button type="button" size="sm" disabled={busy} onClick={propager}>
              Oui, remplacer tous les mois suivants
            </Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setApplique(null)}>
              Non, {monthLabel(info.month).toLowerCase()} seulement
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Vue de gestion d'un groupe (ouverte depuis l'icône au survol d'une ligne de
// groupe) : renommer le groupe, gérer les lignes d'un récurrent (nom, jour, ajout,
// suppression) et supprimer le groupe. Aucun montant ici, volontairement : un montant
// est daté, et ce panneau n'affiche aucun mois — il ne pourrait donc afficher qu'un
// montant vrai pour un seul mois parmi d'autres, ce qui se lisait comme « le » montant
// du groupe et contredisait ce que montrait le tableau. Les montants se fixent depuis
// leur case « Budget dép. », au mois de la colonne (voir BudgetEditBlock).
// Chaque action revalide côté serveur ; on rafraîchit ensuite la vue.
function GroupManageBlock({ info, onClose }: { info: GroupManageInfo; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(info.name);
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newDay, setNewDay] = useState("1");
  // Liste des lignes affichée, en état local optimiste : `info.lines` est un
  // instantané capturé à l'ouverture du panneau, que router.refresh() ne met pas à
  // jour. On la maintient ici pour que l'ajout / la suppression se reflètent tout de
  // suite (la vraie valeur sera rechargée à la prochaine ouverture du panneau).
  const [lines, setLines] = useState(info.lines);
  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    const result = await fn();
    setBusy(false);
    router.refresh();
    return result;
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

        {/* Ajout d'une ligne (récurrent). Les lignes existantes ne se modifient plus
            ici : chacune a son propre crayon dans le tableau, à côté de son nom, qui
            ouvre son panneau (LineManageBlock). Les renommer d'ici obligeait à les
            chercher toutes dans une liste, alors qu'on les a sous les yeux. */}
        {info.kind === "recurring" && (
          <div className="flex flex-col gap-3">
            <Label className="font-normal">Ajouter une ligne</Label>
            {lines.length === 0 && <p className="text-muted-foreground text-sm">Aucune ligne pour l&apos;instant.</p>}
            <div className="mt-1 flex items-end gap-2 border-t pt-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Label className="text-muted-foreground text-xs font-normal">Nom</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8" placeholder="Ex: Spotify" />
              </div>
              {/* Montant de départ de la ligne, seul montant qui subsiste dans ce
                  panneau : il ne montre rien d'existant, il en pose un. Il prend effet
                  au mois où le panneau se place, et se modifie ensuite depuis la case
                  de la ligne, mois par mois. */}
              <div className="flex w-20 flex-col gap-1">
                <Label className="text-muted-foreground text-xs font-normal">Montant de départ</Label>
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
                      setLines((cur) => [...cur, { id, name: n, day: d }]);
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
  // Montant tout juste appliqué : tant qu'il est là, on pose la question de la
  // propagation. Même règle que pour un budget d'enveloppe (voir BudgetEditBlock) :
  // on applique au mois cliqué, puis on demande pour les mois suivants.
  const [applique, setApplique] = useState<number | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    await fn();
    setBusy(false);
    router.refresh();
  };
  const saisi = parseFloat(amount);
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
              onChange={(e) => {
                setAmount(e.target.value);
                setApplique(null);
              }}
              className="h-9 w-28 text-right tabular-nums"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !(saisi >= 0)}
              onClick={async () => {
                await run(() => setUncatProvision(info.month, saisi, "once"));
                setApplique(saisi);
              }}
            >
              Appliquer
            </Button>
          </div>
          {applique !== null && (
            <div className="mt-2 flex flex-col gap-2 rounded-md border p-3 text-sm">
              <p>
                {formatEur(applique)} appliqué à {monthLabel(info.month)}. Les mois suivants
                doivent-ils prendre ce montant ?
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={async () => {
                    await run(() => spreadUncatProvision(info.month, applique));
                    setApplique(null);
                  }}
                >
                  Oui, remplacer tous les mois suivants
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setApplique(null)}>
                  Non, {monthLabel(info.month).toLowerCase()} seulement
                </Button>
              </div>
            </div>
          )}
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
  // Gestion d'une ligne de récurrent : nom, jour, suppression. Aucun montant.
  if (detail.lineManage) {
    return <LineManageBlock info={detail.lineManage} onClose={onClose} />;
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
        {/* Édition du montant sous la décomposition de la case « Budget dép. » : la
            décomposition reste visible, c'est elle qui dit d'où vient le chiffre. */}
        {detail.budgetEdit && <BudgetEditBlock info={detail.budgetEdit} />}
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
