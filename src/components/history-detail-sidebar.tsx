"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, ChevronRight, ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CellDetail, GroupManageInfo, LineManageInfo, UncatProvisionInfo, BudgetEditInfo } from "@/lib/history-explain";
import { monthLabel } from "@/lib/transactions-view";
import { formatEur } from "@/lib/money";
import { detailKey } from "@/lib/history-detail";
import { OverspendNotice } from "@/components/overspend-notice";
import { flattenNodes, cellsForNode, cellsForTotal, TOTAL_ROW, type PanelRow } from "@/lib/history-nav";
import { amountAtMonth, type BudgetChange } from "@/lib/budget-history";
import {
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
import { groupPeriodLabel } from "@/lib/group-period-label";
import { minEndMonth, fitEndMonth, type PeriodMode } from "@/lib/group-period";
import { MonthField } from "@/components/month-field";
import { PERIODS } from "@/components/new-group-inline";
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

// Vue de gestion d'une ligne de récurrent, ouverte par le crayon au survol de la
// ligne dans le tableau. Son nom, seule propriété qui vaille pour tous les mois, et
// sa suppression. Aucun montant : il est daté et se fixe depuis la case
// « Budget dép. » de la ligne, au mois de la colonne — exactement comme pour
// une enveloppe, et pour la même raison (voir BudgetEditBlock).
// Plus de jour du mois non plus : il ne pilotait plus rien d'affiché, et un champ
// qu'on remplit sans effet coûte plus qu'il ne rapporte. La valeur déjà en base
// reste intacte, on la repasse telle quelle au renommage.
function LineManageBlock({ info, onClose }: { info: LineManageInfo; onClose: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(info.name);
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
          <div className="flex items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 flex-1" />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || !name.trim() || name.trim() === info.name}
              onClick={() => run(() => editGroupLine(info.lineId, name.trim(), info.day))}
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
// S'affiche sur n'importe quel mois, écoulé compris : un budget se corrige après coup,
// une fois le relevé sous les yeux. Le seul cas sans bloc du tout est la case d'un
// groupe récurrent, où budgetEditOfGroup rend null — son budget est la somme de ses
// lignes, il n'y a rien à écrire à son niveau.
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
  // Durée de la ligne à ajouter. Elle part du mois où le panneau se place — celui de
  // la colonne cliquée — parce que c'est déjà de là qu'une ligne ajoutée compte ; on
  // peut la déplacer, la frise du compte entière est proposée.
  const [period, setPeriod] = useState<PeriodMode>("from");
  const [start, setStart] = useState(info.month);
  const [end, setEnd] = useState(minEndMonth(info.month));
  const changeStart = (m: string) => {
    setStart(m);
    setEnd(fitEndMonth(m, end));
  };
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
            {/* Sa durée de vie, dite comme dans la colonne de gauche du tableau :
                « ce mois uniquement », « permanent », ou la plage. */}
            <p className="text-muted-foreground/70 text-[10px] tracking-[0.12em] uppercase">
              {groupPeriodLabel(info.startMonth, info.endMonth)}
            </p>
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
            <div className="mt-1 flex flex-col gap-3 border-t pt-3">
              <div className="flex items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label className="text-muted-foreground text-xs font-normal">Nom</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8" placeholder="Ex: Spotify" />
                </div>
                {/* Montant de départ de la ligne, seul montant qui subsiste dans ce
                    panneau : il ne montre rien d'existant, il en pose un. Il prend effet
                    au mois de départ choisi juste en dessous, et se modifie ensuite
                    depuis la case de la ligne, mois par mois. */}
                <div className="flex w-20 flex-col gap-1">
                  <Label className="text-muted-foreground text-xs font-normal">Montant de départ</Label>
                  <Input type="number" step="0.01" min="0" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} className="h-8 text-right tabular-nums" placeholder="0.00" />
                </div>
              </div>
              {/* Durée de la ligne : les mêmes trois choix que pour un groupe, et dans
                  les mêmes mots. Une ligne a sa vie propre — un abonnement se résilie
                  sans emporter le récurrent qui le porte. */}
              <div className="flex flex-col gap-1">
                <Label className="text-muted-foreground text-xs font-normal">Durée</Label>
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value as PeriodMode)}
                  className="h-8 rounded-md border bg-transparent px-2 text-sm"
                >
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <MonthField
                  label={period === "range" ? "Du mois" : period === "single" ? "Mois" : "À partir de"}
                  value={start}
                  onChange={changeStart}
                  min={info.stripMin}
                  max={info.stripMax}
                  className="h-8 w-40"
                />
                {/* Une fin tombe forcément après son début (cf. minEndMonth) : finir le
                    mois où l'on commence, c'est « un seul mois », qui a son propre choix. */}
                {period === "range" && (
                  <MonthField
                    label="Jusqu'au mois"
                    value={end}
                    onChange={setEnd}
                    min={minEndMonth(start)}
                    max={info.stripMax}
                    className="h-8 w-40"
                  />
                )}
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="self-start"
                disabled={busy || !newName.trim()}
                onClick={() =>
                  run(async () => {
                    const n = newName.trim();
                    const a = parseFloat(newAmount) || 0;
                    // Le jour ne se demande plus (il ne pilotait rien d'affiché) : la
                    // colonne existe toujours en base, on y pose 1 sans le dire.
                    const d = 1;
                    const id = await addGroupLine(info.groupId, n, a, d, start, period, end);
                    // On n'ajoute la ligne optimiste qu'avec le vrai id en base : sinon
                    // une suppression/édition immédiate (sans refermer le panneau)
                    // viserait un id fictif et laisserait une ligne fantôme en base.
                    if (id > 0) {
                      setLines((cur) => [...cur, { id, name: n, day: d }]);
                    }
                    setNewName("");
                    setNewAmount("");
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
        {/* Le dépassement de cette case, sous son calcul : c'est là qu'on se demande
            d'où vient le rouge. « Vu » retire le bandeau ET l'étiquette du tableau. */}
        {detail.overspendNotice && (
          <div className="mt-4">
            <OverspendNotice {...detail.overspendNotice} />
          </div>
        )}
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
