"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/transactions-view";
import type { AccountForecast } from "@/lib/forecast";
import { type MonthCell, type HistorySection, type HistoryRow, type HistorySubRow, type HistoryTxn, type SoldeColumn, type PlannedSoldes } from "@/lib/history";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TruncatedText } from "@/components/truncated-text";
import { GroupSelectField } from "@/components/group-select-field";
import {
  type CellDetail,
  type DetailNode,
  type Col,
  cellKey,
  openingRow,
  sectionRow,
  groupRow,
  subRow,
  txnRow,
  makeDetail,
  txnNode,
} from "@/lib/history-explain";

// Groupes du compte, pour le menu de (ré)assignation sur chaque transaction.
type SelectGroup = { id: number; name: string; lines: { id: number; name: string }[] };
const MUTED40 = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";
// Surbrillance de la case sélectionnée depuis le side panel : fond teinté + anneau.
const CELL_HL = "bg-[color-mix(in_oklab,var(--primary)_22%,var(--background))] ring-1 ring-inset ring-primary/60";

// Colonne du tableau qui affiche un montant, selon la nature du nœud. Pour un
// « net » (recu − depense) : la colonne où il apparaît réellement (Dép. pour une
// ligne de dépense pure, Reçu pour une entrée pure), Solde en dernier recours.
function netCol(c: MonthCell): Col {
  if (Math.abs(c.recu) < 0.005) return "depense";
  if (Math.abs(c.depense) < 0.005) return "recu";
  return "solde";
}
function colOf(kind: "depense" | "recu" | "budget" | "net", c: MonthCell): Col {
  return kind === "depense" ? "depense" : kind === "recu" ? "recu" : kind === "budget" ? "budget" : netCol(c);
}

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : n).replace(/[  ]/g, " ");

// Largeur fixe de la première colonne. Un conteneur interne à largeur px fixe
// (et non un max-width sur la cellule, ignoré en table-auto) garantit que la
// colonne ne bouge pas quand on déroule des transactions à long libellé.
const COL1_W = 320;

// --- Modèle de colonnes par type de mois -----------------------------------
// Les colonnes affichées dépendent de la position du mois par rapport au mois
// courant : un mois passé garde les colonnes réelles, le mois courant y ajoute
// les projections (prévu / dépassement), un mois futur ne montre plus le réel.
type MonthType = "past" | "current" | "future";
type ColKey =
  | "budg" | "dep" | "recu" | "reste" | "depassement"
  | "soldeReel" | "soldePrevu" | "soldeDepass"
  | "budget" | "revenus";

function monthType(m: string, currentMonth: string): MonthType {
  return m < currentMonth ? "past" : m === currentMonth ? "current" : "future";
}

function monthColumns(type: MonthType): ColKey[] {
  if (type === "past") return ["budg", "dep", "recu", "reste", "soldeReel"];
  if (type === "current")
    return ["budg", "dep", "recu", "reste", "depassement", "soldeReel", "soldePrevu", "soldeDepass"];
  return ["budget", "revenus", "depassement", "soldePrevu", "soldeDepass"];
}

const COL_LABEL: Record<ColKey, string> = {
  budg: "Budg.",
  dep: "Dép.",
  recu: "Reçu",
  reste: "Reste",
  depassement: "Dépass.",
  soldeReel: "Solde",
  soldePrevu: "Solde prévu",
  soldeDepass: "Solde dépass.",
  budget: "Budget",
  revenus: "Revenus",
};

function labelFor(col: ColKey, type: MonthType): string {
  if (col === "soldeReel" && type === "current") return "Solde réel";
  return COL_LABEL[col];
}

// Cellule vide (colonne non renseignée pour cette ligne), avec bordure de mois si
// c'est la première colonne du mois.
function blankCol(key: string, border: boolean) {
  return <TableCell key={key} className={cn(border && "border-l")} />;
}

// Cellule de solde « plan » (prévu / si dépassement) : affichage simple, non
// cliquable, rouge si négatif ; vide si la valeur est nulle (mois avant le courant).
function plannedSoldeCol(key: string, val: number | null | undefined, border: boolean) {
  return (
    <TableCell key={key} className={cn(border && "border-l", "text-right tabular-nums", val != null && val < -0.005 && "text-red-600")}>
      {val != null ? fmt(val) : ""}
    </TableCell>
  );
}

// Jeu de slots (une fonction de rendu par colonne) toutes vides : sert de base aux
// lignes qui ne renseignent qu'une ou deux colonnes (ouverture, lignes du bas).
function blankSlots(): Record<ColKey, (border: boolean) => React.ReactNode> {
  return {
    budg: (b) => blankCol("budg", b),
    dep: (b) => blankCol("dep", b),
    recu: (b) => blankCol("recu", b),
    reste: (b) => blankCol("reste", b),
    depassement: (b) => blankCol("depassement", b),
    soldeReel: (b) => blankCol("soldeReel", b),
    soldePrevu: (b) => blankCol("soldePrevu", b),
    soldeDepass: (b) => blankCol("soldeDepass", b),
    budget: (b) => blankCol("budget", b),
    revenus: (b) => blankCol("revenus", b),
  };
}

// Boîte à largeur fixe placée dans la cellule de gauche. Le retrait (indent) est
// appliqué à l'intérieur, donc toutes les cellules gardent la même largeur.
function FirstColBox({ children, indent = 0 }: { children: React.ReactNode; indent?: number }) {
  return (
    <div
      className="flex items-center gap-1.5 overflow-hidden py-2 pr-2"
      style={{ width: COL1_W, paddingLeft: `${0.5 + indent * 1.25}rem` }}
    >
      {children}
    </div>
  );
}

// Cellule de montant : cliquable (sélection → sidebar) si un détail est fourni.
// cellKey (data-cellkey) identifie la case pour la surbrillance croisée et le
// défilement depuis le side panel ; elle s'allume quand elle est la case sélectionnée.
function CellAmount({ children, className, detail, onSelect, cellKey: ck, selCellKey }: {
  children: React.ReactNode;
  className?: string;
  detail?: CellDetail | null;
  onSelect?: (d: CellDetail) => void;
  cellKey?: string;
  selCellKey?: string | null;
}) {
  const cls = cn(className, ck != null && ck === selCellKey && CELL_HL);
  if (!detail || !onSelect) return <TableCell data-cellkey={ck} className={cls}>{children}</TableCell>;
  // On rattache la clé de cette case au détail (cellRef), pour pouvoir la surligner
  // depuis la ligne « Total » du side panel.
  return (
    <TableCell data-cellkey={ck} className={cls}>
      <button
        type="button"
        onClick={() => onSelect(ck != null ? { ...detail, cellRef: ck } : detail)}
        className="cursor-pointer decoration-dotted underline-offset-2 hover:underline"
      >
        {children}
      </button>
    </TableCell>
  );
}

// Cellule de solde « plan » (prévu / si dépassement) cliquable : comme
// plannedSoldeCol mais avec un détail (sidebar) et une clé de case. Non cliquable
// si la valeur est absente (cellule vide).
function plannedSoldeCell(
  key: string,
  val: number | null | undefined,
  border: boolean,
  detail: CellDetail | null,
  onSelect: ((d: CellDetail) => void) | undefined,
  ck: string,
  selCellKey?: string | null,
): React.ReactNode {
  return (
    <CellAmount
      key={key}
      className={cn(border && "border-l", "text-right tabular-nums", val != null && val < -0.005 && "text-red-600")}
      detail={val != null ? detail : null}
      onSelect={onSelect}
      cellKey={ck}
      selCellKey={selCellKey}
    >
      {val != null ? fmt(val) : ""}
    </CellAmount>
  );
}

// Transactions d'un groupe (et de ses lignes) pour un mois → nœuds feuilles signés.
// sign = +1 pour un contexte « addition » (ex. colonne Dépensé/Reçu prise positivement),
//        -1 pour un contexte « soustraction » (ex. sous-nœud Dépensé d'un Reste).
// Définie au niveau du module (et non dans HistoryGrid comme suggéré par le brief) car
// AmountCells — qui en a besoin — est lui-même un composant de module, pas imbriqué.
function txnChildren(r: HistoryRow, month: string, sign: 1 | -1, i: number): DetailNode[] | undefined {
  const all = [...r.txns, ...r.subRows.flatMap((s) => s.txns)].filter((t) => t.month === month);
  if (all.length === 0) return undefined;
  return all.map((t) =>
    txnNode(t.date, t.label, sign * Math.abs(t.amount), cellKey(txnRow(t.id), t.amount < 0 ? "depense" : "recu", i)),
  );
}

// Postes (lignes) d'un récurrent pour un mois → nœuds « Budget ». undefined si le
// groupe n'a pas de lignes (enveloppe) ou si tous les postes sont à 0 pour ce mois.
function budgetNodes(r: HistoryRow, i: number): DetailNode[] | undefined {
  if (r.subRows.length === 0) return undefined;
  const nodes = r.subRows
    .map((s): DetailNode => ({ label: s.name, amount: s.cells[i].budgeted, ref: cellKey(subRow(s.id), "budget", i) }))
    .filter((n) => n.amount !== 0);
  return nodes.length > 0 ? nodes : undefined;
}

// --- Task 4 : lignes de synthèse (sous-totaux de section, Solde actuel, Argent
// de départ, Estimé fin de mois, Dépassement) — helpers pour construire leurs
// CellDetail, dépliables jusqu'aux transactions.
//
// Un groupe comme nœud d'un calcul de section/total : montant = sa contribution
// (signée) pour la colonne demandée, enfants = ses transactions du mois (sauf pour
// « budget », qui n'a pas de transactions). Défini au niveau du module (comme
// txnChildren ci-dessus) : (i, month) sont passés explicitement plutôt que capturés
// par fermeture sur `months`, ce composant n'étant pas imbriqué dans HistoryGrid.
function groupNode(r: HistoryRow, i: number, month: string, kind: "depense" | "recu" | "budget" | "net"): DetailNode {
  const c = r.cells[i];
  const amount = kind === "depense" ? c.depense : kind === "recu" ? c.recu : kind === "budget" ? c.budgeted : c.recu - c.depense;
  const sign: 1 | -1 = amount < 0 ? -1 : 1;
  return {
    label: r.name,
    amount,
    children: kind === "budget" ? undefined : txnChildren(r, month, sign, i),
    ref: cellKey(groupRow(r.id), colOf(kind, c), i),
  };
}

// Inverse un nœud (et ses enfants), pour transformer un nœud « Dépensé » positif
// (utilisé tel quel dans une colonne Dépensé) en sous-nœud négatif d'un « Reste ».
function negateNode(n: DetailNode): DetailNode {
  return { ...n, amount: -n.amount, children: n.children?.map(negateNode) };
}

function labelOfSection(kind: HistorySection["kind"]): string {
  switch (kind) {
    case "income":
      return "Rémunérations";
    case "recurring":
      return "Récurrents";
    case "envelope":
      return "Enveloppes";
    case "uncategorized":
      return "Non catégorisés";
  }
}

// Transactions non catégorisées d'un mois → nœuds feuilles, montant signé tel quel
// (contrairement à txnChildren, qui force un signe uniforme : les non catégorisés
// mélangent entrées et sorties dans une même « section », donc on garde le signe
// réel de chaque transaction, ce qui totalise correctement le mouvement net).
function uncatTxnNodes(sec: HistorySection, month: string, i: number): DetailNode[] | undefined {
  const all = (sec.txns ?? []).filter((t) => t.month === month);
  if (all.length === 0) return undefined;
  return all.map((t) => txnNode(t.date, t.label, t.amount, cellKey(txnRow(t.id), t.amount < 0 ? "depense" : "recu", i)));
}

// Variante de txnChildren pour les non catégorisés (pas de HistoryRow : transactions
// à plat sur la section) : ne garde que les transactions du sens demandé (isOut),
// en valeur absolue — même convention que txnChildren(r, month, 1) pour Dépensé/Reçu.
function sectionTxnChildren(txns: HistoryTxn[] | undefined, month: string, isOut: boolean, i: number): DetailNode[] | undefined {
  const filtered = (txns ?? []).filter((t) => t.month === month && (isOut ? t.amount < 0 : t.amount > 0));
  if (filtered.length === 0) return undefined;
  return filtered.map((t) => txnNode(t.date, t.label, Math.abs(t.amount), cellKey(txnRow(t.id), t.amount < 0 ? "depense" : "recu", i)));
}

// Une section comme nœud d'un calcul global (Solde actuel / Estimé / Reçu-Dépensé-
// Budget du grand total) : montant = sa contribution pour la colonne demandée,
// enfants = ses groupes (ou, pour les non catégorisés qui n'ont pas de groupes,
// directement ses transactions).
function sectionNode(sec: HistorySection, i: number, month: string, kind: "depense" | "recu" | "budget" | "net"): DetailNode {
  const t = sec.totals[i];
  const amount = kind === "depense" ? t.depense : kind === "recu" ? t.recu : kind === "budget" ? t.budgeted : t.recu - t.depense;
  const children =
    kind === "budget"
      ? undefined
      : sec.kind === "uncategorized"
        ? kind === "net"
          ? uncatTxnNodes(sec, month, i)
          : sectionTxnChildren(sec.txns, month, kind === "depense", i)
        : (() => {
            const gn = sec.rows.map((r) => groupNode(r, i, month, kind));
            return kind === "net" ? gn : gn.filter((n) => n.amount !== 0);
          })();
  return { label: labelOfSection(sec.kind), amount, children, ref: cellKey(sectionRow(sec.kind), colOf(kind, t), i) };
}

// Détail « Solde actuel » (Argent de départ + chaque section, dépliable jusqu'aux
// transactions). Réutilisé tel quel pour l'« Estimé fin de mois » des mois autres
// que le mois courant (même calcul, seul le titre affiché change).
function soldeActuelDetail(
  sections: HistorySection[],
  solde: SoldeColumn,
  i: number,
  month: string,
  opts: { title: string; result: number },
): CellDetail {
  return makeDetail(
    opts.title,
    [
      { label: "Argent de départ", amount: solde.openings[i], ref: cellKey(openingRow, "solde", i) },
      ...sections.map((sec) => sectionNode(sec, i, month, "net")),
    ],
    { subtitle: monthLabel(month), result: opts.result },
  );
}

// mode : "out" (dépense), "in" (entrée) ou "total" (sous-total, montre les deux
// colonnes). La colonne Solde affiche le solde du compte cumulé, fourni par
// `solde` (une valeur par mois) ; absente ou null => cellule vide.
// detailRow : ligne de groupe (transactions/postes) permettant de construire le
// détail cliquable des cellules. Absente pour les sous-lignes (postes d'un
// récurrent) : ces cellules restent non cliquables (hors périmètre, cf. ci-dessous).
function AmountCells({ cells, mode, solde, soldePrevu, soldeDepass, onSelect, subtitleOf, detailRow, months, currentMonth, rowKey, selCellKey, prevRowKey, incomeKind }: {
  cells: MonthCell[];
  mode: "out" | "in" | "total";
  solde?: (number | null)[];
  // Chaînes de solde « plan » de cette ligne (prévu / si dépassement), une valeur
  // par mois, nulles avant le mois courant. Absentes pour les sous-lignes.
  soldePrevu?: (number | null)[];
  soldeDepass?: (number | null)[];
  onSelect?: (d: CellDetail) => void;
  subtitleOf?: (i: number) => string;
  detailRow?: HistoryRow;
  months: string[];
  currentMonth: string;
  // Clé de ligne de ces cellules (group:… ou subrow:…), pour composer les data-cellkey.
  rowKey: string;
  // Case sélectionnée depuis le side panel (pour la surbrillance).
  selCellKey?: string | null;
  // Ligne dont le solde est le « Solde précédent » de celle-ci (prédécesseur dans
  // l'accumulation) : pour surligner sa case Solde depuis le side panel.
  prevRowKey?: string;
  // Classe de revenu (pour les colonnes Budg./Revenus des rémunérations).
  incomeKind?: "principal" | "supplementary" | null;
}) {
  return (
    <>
      {cells.map((c, i) => {
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = subtitleOf?.(i);
        const r = detailRow;
        const ck = (col: Col) => cellKey(rowKey, col, i);

        const budgetDetail: CellDetail | null = (() => {
          if (mode === "in" || c.budgeted === 0 || !r) return null;
          // Postes du récurrent si présents, sinon un nœud unique (enveloppe, ou
          // sous-ligne synthétisée sans postes) : la case Budg. reste cliquable.
          const nodes = budgetNodes(r, i) ?? [{ label: r.name, amount: c.budgeted }];
          return makeDetail("Budget", nodes, { subtitle, result: c.budgeted });
        })();

        const depDetail: CellDetail | null = (() => {
          if (mode === "in" || c.depense === 0 || !r) return null;
          const nodes = txnChildren(r, month, 1, i);
          return nodes ? makeDetail("Dépensé", nodes, { subtitle, result: c.depense }) : null;
        })();

        const recuDetail: CellDetail | null = (() => {
          if (mode === "out" || c.recu === 0 || !r) return null;
          const nodes = txnChildren(r, month, 1, i);
          return nodes ? makeDetail("Reçu", nodes, { subtitle, result: c.recu }) : null;
        })();

        const resteDetail: CellDetail | null =
          mode !== "in" && r && Math.abs(c.budgeted - c.depense - c.balance) < 0.005
            ? makeDetail(
                "Reste",
                [
                  { label: "Budget", amount: c.budgeted, ref: ck("budget") },
                  { label: "Dépensé", amount: -c.depense, children: txnChildren(r, month, -1, i), ref: ck("depense") },
                ],
                { subtitle, result: c.balance },
              )
            : null;

        const s = solde?.[i];
        const net = c.recu - c.depense;
        // Solde précédent = solde de cette ligne − son propre mouvement.
        const soldeDetail: CellDetail | null =
          s != null && r
            ? makeDetail(
                "Solde",
                [
                  { label: "Solde précédent", amount: s - net, ref: prevRowKey ? cellKey(prevRowKey, "solde", i) : undefined },
                  { label: "Mouvement du mois", amount: net, children: txnChildren(r, month, net < 0 ? -1 : 1, i), ref: ck(netCol(c)) },
                ],
                { subtitle, result: s },
              )
            : null;

        // --- Détails des colonnes de projection (mois courant / futurs) ---------
        const isCurrent = month === currentMonth;

        // Budget de projection (ligne de dépense) : même décomposition par postes
        // que la colonne « Budget » réelle, sinon un nœud unique (enveloppe).
        const projBudgetDetail: CellDetail | null = (() => {
          if (mode !== "out" || c.budgeted === 0 || !r) return null;
          const nodes = budgetNodes(r, i) ?? [{ label: r.name, amount: c.budgeted }];
          return makeDetail("Budget", nodes, { subtitle, result: c.budgeted });
        })();

        // Revenus de projection (rémunération) : la supplémentaire affiche 0 en
        // projection, la principale son montant projeté. Cliquable dès qu'un nombre
        // est affiché (y compris 0,00), avec un détail trivial à un nœud.
        const revenusValue = incomeKind === "supplementary" ? 0 : c.budgeted;
        const revenusDetail: CellDetail | null =
          mode === "in" && r
            ? makeDetail("Revenus", [{ label: r.name, amount: revenusValue }], { subtitle, result: revenusValue })
            : null;

        // Dépassement (ligne de dépense) : Dépensé − Budget, quand > 0.
        const depassVal = mode === "out" ? Math.max(0, c.depense - c.budgeted) : 0;
        const depassDetail: CellDetail | null =
          depassVal > 0.005 && r
            ? makeDetail(
                "Dépassement",
                [
                  { label: "Dépensé", amount: c.depense, children: txnChildren(r, month, 1, i), ref: ck("depense") },
                  { label: "Budget", amount: -c.budgeted, ref: ck("budget") },
                ],
                { subtitle, result: depassVal },
              )
            : null;

        // Mouvement prévu du mois de cette ligne = revenus projeté − budget (même
        // net que la chaîne « solde prévu »).
        const revenusProj = mode === "in" ? (incomeKind === "supplementary" ? (isCurrent ? c.budgeted : 0) : c.budgeted) : 0;
        const budgetProj = mode === "out" ? c.budgeted : 0;
        const mouvementPrevu = revenusProj - budgetProj;
        const sp = soldePrevu?.[i];
        const soldePrevuDetail: CellDetail | null =
          sp != null && r
            ? makeDetail(
                "Solde prévu",
                [
                  { label: "Solde prévu précédent", amount: sp - mouvementPrevu, ref: prevRowKey ? cellKey(prevRowKey, "soldePrevu", i) : undefined },
                  { label: "Mouvement prévu du mois", amount: mouvementPrevu },
                ],
                { subtitle, result: sp },
              )
            : null;
        const sd = soldeDepass?.[i];
        const soldeDepassDetail: CellDetail | null =
          sd != null && sp != null && r
            ? makeDetail(
                "Solde si dépassement",
                [
                  { label: "Solde prévu", amount: sp, ref: ck("soldePrevu") },
                  { label: "Dépassement cumulé", amount: -(sp - sd) },
                ],
                { subtitle, result: sd },
              )
            : null;

        // Colonnes réelles : cliquables (détail + surbrillance) comme avant.
        // Colonnes de projection : désormais cliquables aussi (détail + clé de case).
        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budg: (b) => (
            <CellAmount key="budg" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={budgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {mode === "in" ? (incomeKind === "principal" ? fmt(c.budgeted) : "") : fmt(c.budgeted)}
            </CellAmount>
          ),
          budget: (b) => (
            <CellAmount key="budget" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={projBudgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {mode === "out" ? fmt(c.budgeted) : "—"}
            </CellAmount>
          ),
          revenus: (b) => (
            <CellAmount key="revenus" className={cn(b && "border-l", "text-right tabular-nums")} detail={revenusDetail} onSelect={onSelect} cellKey={ck("revenus")} selCellKey={selCellKey}>
              {mode === "out" ? "—" : incomeKind === "supplementary" ? fmt(0) : fmt(c.budgeted)}
            </CellAmount>
          ),
          dep: (b) => (
            <CellAmount key="dep" className={cn(b && "border-l", "text-right tabular-nums")} detail={depDetail} onSelect={onSelect} cellKey={ck("depense")} selCellKey={selCellKey}>
              {mode === "in" ? "—" : fmt(c.depense)}
            </CellAmount>
          ),
          recu: (b) => (
            <CellAmount key="recu" className={cn(b && "border-l", "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={ck("recu")} selCellKey={selCellKey}>
              {mode === "out" ? "—" : fmt(c.recu)}
            </CellAmount>
          ),
          reste: (b) => (
            <CellAmount key="reste" className={cn(b && "border-l", "text-right tabular-nums", mode !== "in" && c.balance < 0 && "text-red-600")} detail={resteDetail} onSelect={onSelect} cellKey={ck("reste")} selCellKey={selCellKey}>
              {mode === "in" ? "" : fmt(c.balance)}
            </CellAmount>
          ),
          depassement: (b) => (
            <CellAmount key="depassement" className={cn(b && "border-l", "text-right tabular-nums")} detail={depassDetail} onSelect={onSelect} cellKey={ck("depassement")} selCellKey={selCellKey}>
              {mode === "out" ? fmt(Math.max(0, c.depense - c.budgeted)) : "—"}
            </CellAmount>
          ),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && "border-l", "text-right tabular-nums", s != null && s < -0.005 && "text-red-600")} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {s != null ? fmt(s) : ""}
            </CellAmount>
          ),
          soldePrevu: (b) => plannedSoldeCell("soldePrevu", soldePrevu?.[i] ?? null, b, soldePrevuDetail, onSelect, ck("soldePrevu"), selCellKey),
          soldeDepass: (b) => plannedSoldeCell("soldeDepass", soldeDepass?.[i] ?? null, b, soldeDepassDetail, onSelect, ck("soldeDepass"), selCellKey),
        };

        return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
      })}
    </>
  );
}

// Sous-total d'une section (Récurrents / Enveloppes / Non catégorisés) : rendu
// dédié, pas via AmountCells, car aucun HistoryRow unique n'y est associé. Chaque
// cellule se déplie sur la liste des groupes de la section (ou, pour les non
// catégorisés qui n'ont pas de groupes, directement leurs transactions).
// Reste : pour Récurrents/Enveloppes (sections « out » uniquement), budget − dépensé
// == balance exactement par construction (chaque ligne vérifie déjà cette égalité,
// donc leur somme aussi) : toujours cliquable. Pour les non catégorisés, budget et
// balance sont toujours à 0 : l'invariant ne tient que si dépensé == 0, donc en
// pratique non cliquable (comme documenté au Task 3 pour ce cas).
function SectionTotalsCells({ sec, months, currentMonth, onSelect, solde, selCellKey, prevRowKey }: {
  sec: HistorySection;
  months: string[];
  currentMonth: string;
  onSelect?: (d: CellDetail) => void;
  solde?: (number | null)[];
  selCellKey?: string | null;
  // Ligne dont le solde est le « Solde précédent » de cette section (prédécesseur).
  prevRowKey?: string;
}) {
  const isUncat = sec.kind === "uncategorized";
  const rowKey = sectionRow(sec.kind);
  return (
    <>
      {sec.totals.map((c, i) => {
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = `${labelOfSection(sec.kind)} · ${monthLabel(month)}`;
        const ck = (col: Col) => cellKey(rowKey, col, i);

        const budgetDetail: CellDetail | null =
          c.budgeted !== 0
            ? makeDetail("Budget", sec.rows.map((r) => groupNode(r, i, month, "budget")), { subtitle, result: c.budgeted })
            : null;

        const depNodes = isUncat
          ? sectionTxnChildren(sec.txns, month, true, i)
          : sec.rows.map((r) => groupNode(r, i, month, "depense")).filter((n) => n.amount !== 0);
        const depDetail: CellDetail | null =
          c.depense !== 0 && depNodes ? makeDetail("Dépensé", depNodes, { subtitle, result: c.depense }) : null;

        const recuNodes = isUncat
          ? sectionTxnChildren(sec.txns, month, false, i)
          : sec.rows.map((r) => groupNode(r, i, month, "recu")).filter((n) => n.amount !== 0);
        const recuDetail: CellDetail | null =
          c.recu !== 0 && recuNodes ? makeDetail("Reçu", recuNodes, { subtitle, result: c.recu }) : null;

        const resteDetail: CellDetail | null =
          Math.abs(c.budgeted - c.depense - c.balance) < 0.005
            ? makeDetail(
                "Reste",
                [
                  { label: "Budget", amount: c.budgeted, ref: ck("budget") },
                  {
                    label: "Dépensé",
                    amount: -c.depense,
                    ref: ck("depense"),
                    children: sec.rows
                      .map((r) => groupNode(r, i, month, "depense"))
                      .filter((n) => n.amount !== 0)
                      .map(negateNode),
                  },
                ],
                { subtitle, result: c.balance },
              )
            : null;

        const s = solde?.[i];
        const net = c.recu - c.depense;
        const soldeDetail: CellDetail | null =
          s != null
            ? makeDetail(
                "Solde",
                [
                  { label: "Solde précédent", amount: s - net, ref: prevRowKey ? cellKey(prevRowKey, "solde", i) : undefined },
                  { label: "Mouvement du mois", amount: net, children: uncatTxnNodes(sec, month, i), ref: ck(netCol(c)) },
                ],
                { subtitle, result: s },
              )
            : null;

        // Dépassement de la section = somme des dépassements de ses lignes de dépense
        // (les non catégorisés n'ont pas de budget, donc pas de dépassement).
        const secDepass = sec.rows.reduce(
          (a, r) => a + (r.direction === "out" ? Math.max(0, r.cells[i].depense - r.cells[i].budgeted) : 0),
          0,
        );
        // Détail du dépassement de la section : un nœud par groupe qui dépasse.
        const secDepassNodes = sec.rows
          .filter((r) => r.direction === "out")
          .map((r): DetailNode => ({ label: r.name, amount: Math.max(0, r.cells[i].depense - r.cells[i].budgeted), ref: cellKey(groupRow(r.id), "depassement", i) }))
          .filter((n) => n.amount > 0.005);
        const depassDetail: CellDetail | null =
          !isUncat && secDepass > 0.005 && secDepassNodes.length > 0
            ? makeDetail("Dépassement", secDepassNodes, { subtitle, result: secDepass })
            : null;

        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budg: (b) => (
            <CellAmount key="budg" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={budgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {fmt(c.budgeted)}
            </CellAmount>
          ),
          budget: (b) => (
            <CellAmount key="budget" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={budgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {isUncat ? "—" : fmt(c.budgeted)}
            </CellAmount>
          ),
          revenus: (b) => (
            <TableCell key="revenus" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
          ),
          dep: (b) => (
            <CellAmount key="dep" className={cn(b && "border-l", "text-right tabular-nums")} detail={depDetail} onSelect={onSelect} cellKey={ck("depense")} selCellKey={selCellKey}>
              {fmt(c.depense)}
            </CellAmount>
          ),
          recu: (b) => (
            <CellAmount key="recu" className={cn(b && "border-l", "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={ck("recu")} selCellKey={selCellKey}>
              {fmt(c.recu)}
            </CellAmount>
          ),
          reste: (b) => (
            <CellAmount key="reste" className={cn(b && "border-l", "text-right tabular-nums", c.balance < 0 && "text-red-600")} detail={resteDetail} onSelect={onSelect} cellKey={ck("reste")} selCellKey={selCellKey}>
              {fmt(c.balance)}
            </CellAmount>
          ),
          depassement: (b) => (
            <CellAmount key="depassement" className={cn(b && "border-l", "text-right tabular-nums", secDepass > 0 && "text-red-600")} detail={depassDetail} onSelect={onSelect} cellKey={ck("depassement")} selCellKey={selCellKey}>
              {isUncat ? "—" : fmt(secDepass)}
            </CellAmount>
          ),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && "border-l", "text-right tabular-nums", s != null && s < -0.005 && "text-red-600")} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {s != null ? fmt(s) : ""}
            </CellAmount>
          ),
          soldePrevu: (b) => plannedSoldeCol("soldePrevu", null, b),
          soldeDepass: (b) => plannedSoldeCol("soldeDepass", null, b),
        };

        return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
      })}
    </>
  );
}

// Ligne « Total rémunérations » : somme des rémunérations principale et
// supplémentaire. Seule la colonne Reçu est renseignée (les rémunérations n'ont ni
// budget ni dépense) ; cliquable → détail dépliable jusqu'aux transactions.
function IncomeTotalCells({ sec, months, currentMonth, onSelect, selCellKey }: {
  sec: HistorySection;
  months: string[];
  currentMonth: string;
  onSelect?: (d: CellDetail) => void;
  selCellKey?: string | null;
}) {
  return (
    <>
      {sec.totals.map((c, i) => {
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = `Rémunérations · ${monthLabel(month)}`;
        const recuDetail: CellDetail | null =
          c.recu !== 0
            ? makeDetail("Rémunérations", sec.rows.map((r) => groupNode(r, i, month, "recu")).filter((n) => n.amount !== 0), { subtitle, result: c.recu })
            : null;
        // Revenu projeté total = rémunération principale (la supplémentaire n'est pas
        // projetée sur les mois futurs). Aussi la valeur du Budget principal-only.
        const principalBudget = sec.rows
          .filter((r) => r.incomeKind === "principal")
          .reduce((s, r) => s + r.cells[i].budgeted, 0);
        // Détail des revenus projetés : un nœud par rémunération principale.
        const revenusNodes = sec.rows
          .filter((r) => r.incomeKind === "principal")
          .map((r): DetailNode => ({ label: r.name, amount: r.cells[i].budgeted, ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const revenusDetail: CellDetail | null =
          principalBudget !== 0 && revenusNodes.length > 0
            ? makeDetail("Revenus", revenusNodes, { subtitle, result: principalBudget })
            : null;

        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budg: (b) => (
            <TableCell key="budg" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>
              {principalBudget !== 0 ? fmt(principalBudget) : ""}
            </TableCell>
          ),
          budget: (b) => (
            <TableCell key="budget" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
          ),
          revenus: (b) => (
            <CellAmount key="revenus" className={cn(b && "border-l", "text-right tabular-nums")} detail={revenusDetail} onSelect={onSelect} cellKey={cellKey(sectionRow("income"), "revenus", i)} selCellKey={selCellKey}>
              {fmt(principalBudget)}
            </CellAmount>
          ),
          dep: (b) => (
            <TableCell key="dep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
          ),
          recu: (b) => (
            <CellAmount key="recu" className={cn(b && "border-l", "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={cellKey(sectionRow("income"), "recu", i)} selCellKey={selCellKey}>
              {fmt(c.recu)}
            </CellAmount>
          ),
          reste: (b) => blankCol("reste", b),
          depassement: (b) => (
            <TableCell key="depassement" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
          ),
          soldeReel: (b) => blankCol("soldeReel", b),
          soldePrevu: (b) => blankCol("soldePrevu", b),
          soldeDepass: (b) => blankCol("soldeDepass", b),
        };

        return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
      })}
    </>
  );
}

// Ligne « Solde actuel » (grand total) : rendu dédié, pas via AmountCells. Budg./
// Dép./Reçu se déplient sur la liste des sections (elles-mêmes dépliables sur leurs
// groupes, puis leurs transactions) ; Solde = Argent de départ + chaque section.
// Reste : cliquable seulement si l'invariant budget − dépensé == balance tient
// (souvent faux au global : la section Rémunérations a un budget mais pas de
// dépense, donc généralement non cliquable — ce qui est acceptable, cf. brief).
function GrandTotalsCells({ sections, grand, solde, planned, overspend, months, currentMonth, onSelect, selCellKey }: {
  sections: HistorySection[];
  grand: MonthCell[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  overspend: number[];
  months: string[];
  currentMonth: string;
  onSelect?: (d: CellDetail) => void;
  selCellKey?: string | null;
}) {
  return (
    <>
      {grand.map((c, i) => {
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = monthLabel(month);
        const ck = (col: Col) => cellKey("grand", col, i);
        // Revenu projeté total = somme des rémunérations principales (supplémentaire
        // non projetée sur les mois futurs).
        const revenusTotal = sections
          .flatMap((s) => s.rows)
          .reduce((a, r) => a + (r.direction === "in" ? (r.incomeKind === "supplementary" ? 0 : r.cells[i].budgeted) : 0), 0);

        // Budget des dépenses seulement (excluant les rémunérations) pour la colonne
        // projection « Budget » du grand total.
        const expenseBudget = sections.reduce((s, sec) => s + (sec.kind === "income" ? 0 : sec.totals[i].budgeted), 0);

        const budgetDetail: CellDetail | null =
          c.budgeted !== 0
            ? makeDetail("Budget", sections.map((sec) => sectionNode(sec, i, month, "budget")), { subtitle, result: c.budgeted })
            : null;
        const depDetail: CellDetail | null =
          c.depense !== 0
            ? makeDetail(
                "Dépensé",
                sections.map((sec) => sectionNode(sec, i, month, "depense")).filter((n) => n.amount !== 0),
                { subtitle, result: c.depense },
              )
            : null;
        const recuDetail: CellDetail | null =
          c.recu !== 0
            ? makeDetail(
                "Reçu",
                sections.map((sec) => sectionNode(sec, i, month, "recu")).filter((n) => n.amount !== 0),
                { subtitle, result: c.recu },
              )
            : null;
        const resteDetail: CellDetail | null =
          Math.abs(c.budgeted - c.depense - c.balance) < 0.005
            ? makeDetail(
                "Reste",
                [
                  { label: "Budget", amount: c.budgeted, ref: ck("budget") },
                  {
                    label: "Dépensé",
                    amount: -c.depense,
                    ref: ck("depense"),
                    children: sections
                      .map((sec) => sectionNode(sec, i, month, "depense"))
                      .filter((n) => n.amount !== 0)
                      .map(negateNode),
                  },
                ],
                { subtitle, result: c.balance },
              )
            : null;
        const soldeDetail: CellDetail = soldeActuelDetail(sections, solde, i, month, { title: "Solde actuel", result: solde.closings[i] });

        // --- Détails des colonnes de projection du grand total ------------------
        // Budget de projection : seules les sections de dépense (cohérent avec la
        // valeur affichée expenseBudget, qui exclut les rémunérations).
        const expenseBudgetDetail: CellDetail | null =
          expenseBudget !== 0
            ? makeDetail("Budget", sections.filter((sec) => sec.kind !== "income").map((sec) => sectionNode(sec, i, month, "budget")), { subtitle, result: expenseBudget })
            : null;
        // Revenus projetés : un nœud par rémunération principale (supplémentaire = 0).
        const revenusNodes = sections
          .flatMap((s) => s.rows)
          .filter((r) => r.direction === "in" && r.incomeKind !== "supplementary")
          .map((r): DetailNode => ({ label: r.name, amount: r.cells[i].budgeted, ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const revenusDetail: CellDetail | null =
          revenusTotal !== 0 && revenusNodes.length > 0
            ? makeDetail("Revenus", revenusNodes, { subtitle, result: revenusTotal })
            : null;
        // Dépassement : un nœud par groupe qui dépasse (comme la ligne « Dépassement »).
        const depassDetail: CellDetail | null =
          overspend[i] > 0
            ? makeDetail(
                "Dépassement",
                sections
                  .flatMap((s) => s.rows)
                  .filter((r) => r.direction === "out" && r.cells[i].balance < 0)
                  .map((r): DetailNode => ({ label: r.name, amount: -r.cells[i].balance, ref: cellKey(groupRow(r.id), "depassement", i) })),
                { subtitle, result: overspend[i] },
              )
            : null;
        // Soldes de plan (prévu / si dépassement) : structure « précédent + mouvement »
        // (cf. brief). Le « précédent » = clôture prévue du mois passé, ou l'ouverture
        // réelle au mois courant. Le mouvement = clôture − précédent (exact par défaut).
        const prevuClose = planned.prevuClosings[i];
        const depassClose = planned.depassClosings[i];
        const prevuPrev =
          month === currentMonth ? solde.openings[i] : i > 0 && planned.prevuClosings[i - 1] != null ? planned.prevuClosings[i - 1]! : solde.openings[i];
        const soldePrevuDetail: CellDetail | null =
          prevuClose != null
            ? makeDetail(
                "Solde prévu",
                [
                  { label: "Solde prévu précédent", amount: prevuPrev, ref: month === currentMonth ? cellKey(openingRow, "soldePrevu", i) : cellKey("grand", "soldePrevu", i - 1) },
                  { label: "Mouvement prévu du mois", amount: prevuClose - prevuPrev },
                ],
                { subtitle, result: prevuClose },
              )
            : null;
        const soldeDepassDetail: CellDetail | null =
          depassClose != null && prevuClose != null
            ? makeDetail(
                "Solde si dépassement",
                [
                  { label: "Solde prévu", amount: prevuClose, ref: ck("soldePrevu") },
                  { label: "Dépassement cumulé", amount: -(prevuClose - depassClose) },
                ],
                { subtitle, result: depassClose },
              )
            : null;

        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budg: (b) => (
            <CellAmount key="budg" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={budgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {fmt(c.budgeted)}
            </CellAmount>
          ),
          budget: (b) => (
            <CellAmount key="budget" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={expenseBudgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {fmt(expenseBudget)}
            </CellAmount>
          ),
          revenus: (b) => (
            <CellAmount key="revenus" className={cn(b && "border-l", "text-right tabular-nums")} detail={revenusDetail} onSelect={onSelect} cellKey={ck("revenus")} selCellKey={selCellKey}>
              {fmt(revenusTotal)}
            </CellAmount>
          ),
          dep: (b) => (
            <CellAmount key="dep" className={cn(b && "border-l", "text-right tabular-nums")} detail={depDetail} onSelect={onSelect} cellKey={ck("depense")} selCellKey={selCellKey}>
              {fmt(c.depense)}
            </CellAmount>
          ),
          recu: (b) => (
            <CellAmount key="recu" className={cn(b && "border-l", "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={ck("recu")} selCellKey={selCellKey}>
              {fmt(c.recu)}
            </CellAmount>
          ),
          reste: (b) => (
            <CellAmount key="reste" className={cn(b && "border-l", "text-right tabular-nums", c.balance < 0 && "text-red-600")} detail={resteDetail} onSelect={onSelect} cellKey={ck("reste")} selCellKey={selCellKey}>
              {fmt(c.balance)}
            </CellAmount>
          ),
          depassement: (b) => (
            <CellAmount key="depassement" className={cn(b && "border-l", "text-right tabular-nums", overspend[i] > 0 && "text-red-600")} detail={depassDetail} onSelect={onSelect} cellKey={ck("depassement")} selCellKey={selCellKey}>
              {overspend[i] > 0 ? fmt(overspend[i]) : "—"}
            </CellAmount>
          ),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && "border-l", "text-right tabular-nums", solde.closings[i] < -0.005 && "text-red-600")} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {fmt(solde.closings[i])}
            </CellAmount>
          ),
          soldePrevu: (b) => plannedSoldeCell("soldePrevu", planned.prevuClosings[i], b, soldePrevuDetail, onSelect, ck("soldePrevu"), selCellKey),
          soldeDepass: (b) => plannedSoldeCell("soldeDepass", planned.depassClosings[i], b, soldeDepassDetail, onSelect, ck("soldeDepass"), selCellKey),
        };

        return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
      })}
    </>
  );
}

// Cellules d'une transaction : son montant tombe dans la colonne Dép. (sortie)
// ou Reçu (entrée), selon son signe, du mois où elle a lieu ; le reste est vide.
function TxnCells({ txn, months, currentMonth, onSelect, selCellKey }: { txn: HistoryTxn; months: string[]; currentMonth: string; onSelect?: (d: CellDetail) => void; selCellKey?: string | null }) {
  const isOut = txn.amount < 0;
  return (
    <>
      {months.map((m, i) => {
        const cols = monthColumns(monthType(m, currentMonth));
        const here = txn.month === m;
        const val = here ? fmt(Math.abs(txn.amount)) : "";
        // La transaction n'occupe qu'une case : Dép. si sortie, Reçu si entrée. En
        // mois de projection, ni Dép. ni Reçu n'existent : la ligne reste vide.
        const ck = here ? cellKey(txnRow(txn.id), isOut ? "depense" : "recu", i) : undefined;
        // Détail minimal d'une transaction : une seule feuille (elle-même), pour que
        // sa case chiffrée soit cliquable comme les montants agrégés.
        const detail: CellDetail | null = here
          ? makeDetail(
              "Transaction",
              [{ label: `${txn.date} · ${txn.label}`, amount: Math.abs(txn.amount) }],
              { subtitle: monthLabel(m), result: Math.abs(txn.amount) },
            )
          : null;
        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budg: (b) => blankCol("budg", b),
          budget: (b) => blankCol("budget", b),
          revenus: (b) => blankCol("revenus", b),
          dep: (b) =>
            here && isOut ? (
              <CellAmount key="dep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={detail} onSelect={onSelect} cellKey={ck} selCellKey={selCellKey}>
                {val}
              </CellAmount>
            ) : (
              <TableCell key="dep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} />
            ),
          recu: (b) =>
            here && !isOut ? (
              <CellAmount key="recu" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={detail} onSelect={onSelect} cellKey={ck} selCellKey={selCellKey}>
                {val}
              </CellAmount>
            ) : (
              <TableCell key="recu" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} />
            ),
          reste: (b) => blankCol("reste", b),
          depassement: (b) => blankCol("depassement", b),
          soldeReel: (b) => blankCol("soldeReel", b),
          soldePrevu: (b) => blankCol("soldePrevu", b),
          soldeDepass: (b) => blankCol("soldeDepass", b),
        };
        return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
      })}
    </>
  );
}

// Cellule gauche (sticky) d'une ligne, avec retrait et chevron optionnel.
function NameCell({ children, indent, expandable, expanded, onToggle, bg = "bg-background" }: {
  children: React.ReactNode;
  indent: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  bg?: string;
}) {
  return (
    <TableCell
      className={cn(bg, "sticky left-0 z-10 p-0", expandable && "cursor-pointer")}
      onClick={onToggle}
    >
      <FirstColBox indent={indent}>
        {expandable ? (
          expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />
        ) : (
          <span className="inline-block size-4 shrink-0" />
        )}
        {children}
      </FirstColBox>
    </TableCell>
  );
}

// Ligne de transaction : « date · libellé » puis, en dessous, le menu de
// (ré)assignation de groupe. Le montant tombe dans la colonne de son mois.
function TxnRow({ txn, months, currentMonth, groups, indent, onSelect, selCellKey }: {
  txn: HistoryTxn;
  months: string[];
  currentMonth: string;
  groups: SelectGroup[];
  indent: number;
  onSelect?: (d: CellDetail) => void;
  selCellKey?: string | null;
}) {
  return (
    <TableRow className="align-top text-sm text-muted-foreground">
      <TableCell className="bg-background sticky left-0 z-10 p-0">
        <div
          className="flex flex-col gap-1 py-2 pr-2"
          style={{ width: COL1_W, paddingLeft: `${0.5 + indent * 1.25}rem` }}
        >
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="shrink-0 tabular-nums">{txn.date}</span>
            <TruncatedText text={txn.label} className="min-w-0 flex-1" />
          </div>
          <GroupSelectField
            txnId={txn.id}
            groups={groups}
            defaultGroupId={txn.groupId}
            defaultLineId={txn.lineId}
          />
        </div>
      </TableCell>
      <TxnCells txn={txn} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} />
    </TableRow>
  );
}

export function HistoryGrid({ months, currentMonth, forecast, sections, overspend, grand, groups, solde, planned, onSelect, selected }: {
  months: string[];
  currentMonth: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  // Clic sur un montant : remonté au parent, qui l'affiche dans la sidebar.
  onSelect: (d: CellDetail) => void;
  // Case à surligner, sélectionnée depuis le side panel (clé data-cellkey, null = aucune).
  selected?: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const selCellKey = selected ?? null;
  // Transaction sélectionnée : son id est encodé dans la clé « txn:<id>::col::mois ».
  const selTxnId = selCellKey?.startsWith("txn:") ? selCellKey.slice(4, selCellKey.indexOf("::")) : null;
  // Conteneur du tableau (display:contents) : sert à repérer, par data-cellkey, la
  // case sélectionnée pour la faire défiler dans la vue — sans être lui-même un
  // conteneur de mise en page.
  const gridRef = useRef<HTMLDivElement>(null);

  // Pour une transaction : clés de dépliage de ses ancêtres (groupe, et éventuelle
  // ligne), afin de la révéler dans le tableau quand on la sélectionne.
  const txnOpenKeys = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const sec of sections) {
      if (sec.kind === "uncategorized") {
        for (const t of sec.txns ?? []) m.set(t.id, ["s:uncat"]);
      } else {
        for (const r of sec.rows) {
          for (const t of r.txns) m.set(t.id, [`g:${r.id}`]);
          for (const sub of r.subRows) for (const t of sub.txns) m.set(t.id, [`g:${r.id}`, `l:${sub.id}`]);
        }
      }
    }
    return m;
  }, [sections]);

  // « Solde précédent » d'une ligne = solde de la ligne qui la précède dans
  // l'accumulation (même ordre que computeSolde : ouverture, puis les lignes de
  // chaque section, les non catégorisés comptant pour une seule étape). On mappe
  // chaque étape porteuse de solde vers la clé de ligne de la précédente, pour
  // surligner la bonne case Solde.
  const prevSoldeRowKey = useMemo(() => {
    const stops: string[] = [openingRow];
    for (const sec of sections) {
      if (sec.kind === "uncategorized") stops.push(sectionRow("uncategorized"));
      else for (const r of sec.rows) stops.push(groupRow(r.id));
    }
    const m = new Map<string, string>();
    for (let k = 1; k < stops.length; k++) m.set(stops[k], stops[k - 1]);
    return m;
  }, [sections]);

  // Dépliage effectif = dépliage utilisateur, plus les ancêtres de la transaction
  // sélectionnée (pour la révéler sans muter l'état de dépliage manuel). Dérivé
  // plutôt que posé dans un effet : pas de setState en cascade.
  const effectiveOpen = useMemo(() => {
    if (!selTxnId) return open;
    const keys = txnOpenKeys.get(selTxnId);
    if (!keys || keys.every((k) => open.has(k))) return open;
    const next = new Set(open);
    for (const k of keys) next.add(k);
    return next;
  }, [open, selTxnId, txnOpenKeys]);
  const isOpen = (k: string) => effectiveOpen.has(k);

  // Faire défiler la case sélectionnée dans la vue (après dépliage éventuel : la
  // dépendance sur effectiveOpen relance l'effet une fois la ligne montée).
  useEffect(() => {
    if (!selCellKey) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cellkey="${selCellKey}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selCellKey, effectiveOpen]);

  // topLevel : ligne au niveau des sections (rémunérations), bande grise comme
  // les en-têtes Récurrents / Enveloppes.
  const renderGroup = (r: HistoryRow, topLevel = false) => {
    const gKey = `g:${r.id}`;
    const selfKey = groupRow(r.id);
    const hasChildren = r.subRows.length > 0 || r.txns.length > 0;
    const gOpen = isOpen(gKey);
    return (
      <Fragment key={r.id}>
        <TableRow className={cn(topLevel ? "bg-muted/40 hover:bg-muted/40 font-medium" : hasChildren && "hover:bg-muted/50")}>
          <NameCell indent={0} bg={topLevel ? MUTED40 : undefined} expandable={hasChildren} expanded={gOpen} onToggle={hasChildren ? () => toggle(gKey) : undefined}>
            {r.direction === "in" ? (
              <ArrowUpRight className="size-4 shrink-0 text-sky-600" />
            ) : (
              <ArrowDownRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate font-medium">{r.name}</span>
          </NameCell>
          <AmountCells
            cells={r.cells}
            mode={r.direction}
            solde={solde.rowRunning[r.id]}
            soldePrevu={planned.prevuRowRunning[r.id]}
            soldeDepass={planned.depassRowRunning[r.id]}
            onSelect={onSelect}
            subtitleOf={(i) => `${r.name} · ${monthLabel(months[i])}`}
            detailRow={r}
            months={months}
            currentMonth={currentMonth}
            rowKey={selfKey}
            selCellKey={selCellKey}
            prevRowKey={prevSoldeRowKey.get(selfKey)}
            incomeKind={r.incomeKind}
          />
        </TableRow>
        {gOpen && (
          <>
            {r.subRows.map((sub: HistorySubRow) => {
              const lKey = `l:${sub.id}`;
              const lOpen = isOpen(lKey);
              const subHasTxns = sub.txns.length > 0;
              // Ligne synthétisée à partir du poste : réutilise les helpers de détail
              // (budgetNodes → nœud unique, txnChildren → transactions du poste). Sans
              // subRows ni chaîne de solde, les cases Solde restent vides/non cliquables.
              const subAsRow: HistoryRow = {
                id: sub.id,
                name: sub.name,
                kind: "recurring",
                direction: r.direction,
                incomeKind: null,
                cells: sub.cells,
                subRows: [],
                txns: sub.txns,
              };
              return (
                <Fragment key={sub.id}>
                  <TableRow className={cn("text-sm", subHasTxns && "hover:bg-muted/50")}>
                    <NameCell indent={1} expandable={subHasTxns} expanded={lOpen} onToggle={subHasTxns ? () => toggle(lKey) : undefined}>
                      <span className="min-w-0 truncate">{sub.name}</span>
                    </NameCell>
                    {/* Sous-ligne (poste d'un récurrent) : cellules désormais cliquables
                        (détail dérivé du poste). Les cases Solde restent vides. */}
                    <AmountCells
                      cells={sub.cells}
                      mode={r.direction}
                      onSelect={onSelect}
                      subtitleOf={(i) => `${sub.name} · ${monthLabel(months[i])}`}
                      detailRow={subAsRow}
                      months={months}
                      currentMonth={currentMonth}
                      rowKey={subRow(sub.id)}
                      selCellKey={selCellKey}
                      incomeKind={r.incomeKind}
                    />
                  </TableRow>
                  {lOpen && sub.txns.map((t) => (
                    <TxnRow key={t.id} txn={t} months={months} currentMonth={currentMonth} groups={groups} indent={2} onSelect={onSelect} selCellKey={selCellKey} />
                  ))}
                </Fragment>
              );
            })}
            {r.txns.map((t) => (
              <TxnRow key={t.id} txn={t} months={months} currentMonth={currentMonth} groups={groups} indent={1} onSelect={onSelect} selCellKey={selCellKey} />
            ))}
          </>
        )}
      </Fragment>
    );
  };

  return (
    // display:contents : ce conteneur ne crée pas de boîte (il n'affecte pas la
    // mise en page), il sert seulement d'ancre pour retrouver, par data-cellkey, la
    // case sélectionnée à faire défiler dans la vue.
    <div ref={gridRef} style={{ display: "contents" }}>
    {/* w-max : la largeur du tableau suit son contenu, pas le conteneur. Sinon
        (w-full par defaut) les colonnes se resserrent quand la sidebar de detail
        s'ouvre et retrecit la zone : le tableau doit defiler, pas se tasser. */}
    <Table className="w-max">
      <TableHeader>
        <TableRow>
          <TableHead rowSpan={2} className="bg-background sticky left-0 z-10 p-0 align-bottom">
            <FirstColBox>Catégorie</FirstColBox>
          </TableHead>
          {months.map((m) => {
            const cols = monthColumns(monthType(m, currentMonth));
            return (
              <TableHead
                key={m}
                colSpan={cols.length}
                data-current-month={m === currentMonth ? "" : undefined}
                className={cn(
                  "border-l text-center whitespace-nowrap",
                  m === currentMonth && "text-foreground font-semibold",
                  m > currentMonth && "text-muted-foreground italic",
                )}
              >
                {monthLabel(m)}
                {m > currentMonth ? " · projection" : ""}
              </TableHead>
            );
          })}
        </TableRow>
        <TableRow>
          {months.map((m) => {
            const type = monthType(m, currentMonth);
            const cols = monthColumns(type);
            return (
              <Fragment key={m}>
                {cols.map((col, idx) => (
                  <TableHead key={col} className={cn(idx === 0 && "border-l", "text-right")}>
                    {labelFor(col, type)}
                  </TableHead>
                ))}
              </Fragment>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
          <TableCell className={cn("sticky left-0 z-10 p-0", MUTED40)}>
            <FirstColBox>Argent de départ</FirstColBox>
          </TableCell>
          {solde.openings.map((v, i) => {
            // 1er mois affiché : reconstitué en rembobinant depuis le solde réel de
            // la banque (forecast.balance = a.balance, l'ancre de computeSolde).
            // Mois suivants : hérité du solde de clôture du mois précédent.
            const detail: CellDetail =
              i === 0
                ? makeDetail(
                    "Argent de départ",
                    [
                      { label: "Solde du compte (banque)", amount: forecast.balance },
                      { label: "Mouvements de la période (rembobinés)", amount: solde.openings[0] - forecast.balance },
                    ],
                    {
                      subtitle: monthLabel(months[0]),
                      result: solde.openings[0],
                      note: "Reconstitué en rembobinant les mouvements depuis le solde réel de la banque.",
                    },
                  )
                : makeDetail(
                    "Argent de départ",
                    [{ label: "Solde de fin du mois précédent", amount: solde.closings[i - 1] }],
                    { subtitle: monthLabel(months[i]), result: solde.openings[i] },
                  );
            const type = monthType(months[i], currentMonth);
            const cols = monthColumns(type);
            // L'ouverture est commune aux trois chaînes au mois courant. En
            // projection, l'ouverture d'une chaîne = clôture (prévue / si dépassement)
            // du mois précédent ; repli sur l'argent de départ réel au 1er mois.
            const prevuOpen =
              months[i] === currentMonth ? v : i > 0 && planned.prevuClosings[i - 1] != null ? planned.prevuClosings[i - 1] : v;
            const depassOpen =
              months[i] === currentMonth ? v : i > 0 && planned.depassClosings[i - 1] != null ? planned.depassClosings[i - 1] : v;
            const openingCell = (b: boolean) => (
              <CellAmount key="soldeReel" className={cn(b && "border-l", "text-right tabular-nums", v < -0.005 && "text-red-600")} detail={detail} onSelect={onSelect} cellKey={cellKey(openingRow, "solde", i)} selCellKey={selCellKey}>
                {fmt(v)}
              </CellAmount>
            );
            // Détail des ouvertures de plan : au mois courant, l'ouverture prévue /
            // si dépassement vaut l'argent de départ réel (même détail). En
            // projection, elle vaut la clôture (prévue / si dépassement) du mois passé.
            const prevuOpenDetail: CellDetail =
              months[i] === currentMonth
                ? detail
                : makeDetail(
                    "Argent de départ",
                    [{ label: "Solde prévu de fin du mois précédent", amount: prevuOpen ?? 0, ref: i > 0 ? cellKey("grand", "soldePrevu", i - 1) : undefined }],
                    { subtitle: monthLabel(months[i]), result: prevuOpen ?? 0 },
                  );
            const depassOpenDetail: CellDetail =
              months[i] === currentMonth
                ? detail
                : makeDetail(
                    "Argent de départ",
                    [{ label: "Solde de fin du mois précédent (si dépassement)", amount: depassOpen ?? 0, ref: i > 0 ? cellKey("grand", "soldeDepass", i - 1) : undefined }],
                    { subtitle: monthLabel(months[i]), result: depassOpen ?? 0 },
                  );
            const slots = blankSlots();
            slots.soldeReel = openingCell;
            slots.soldePrevu = (b) => plannedSoldeCell("soldePrevu", prevuOpen, b, prevuOpenDetail, onSelect, cellKey(openingRow, "soldePrevu", i), selCellKey);
            slots.soldeDepass = (b) => plannedSoldeCell("soldeDepass", depassOpen, b, depassOpenDetail, onSelect, cellKey(openingRow, "soldeDepass", i), selCellKey);
            return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
          })}
        </TableRow>
        {sections.map((sec) => {
          if (sec.kind === "income") {
            // Rémunérations : lignes au niveau des sections, tout en haut, sans en-tête,
            // suivies d'une ligne « Total rémunérations » (principale + supplémentaire).
            return (
              <Fragment key={sec.kind}>
                {sec.rows.map((r) => renderGroup(r, true))}
                <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                  <TableCell className={cn("sticky left-0 z-10 p-0", MUTED40)}>
                    <FirstColBox>Total rémunérations</FirstColBox>
                  </TableCell>
                  <IncomeTotalCells sec={sec} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} />
                </TableRow>
              </Fragment>
            );
          }
          if (sec.kind === "uncategorized") {
            const uKey = "s:uncat";
            const uOpen = isOpen(uKey);
            const hasTxns = (sec.txns?.length ?? 0) > 0;
            return (
              <Fragment key={sec.kind}>
                <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                  <NameCell indent={0} bg={MUTED40} expandable={hasTxns} expanded={uOpen} onToggle={hasTxns ? () => toggle(uKey) : undefined}>
                    <span className="min-w-0 truncate">Non catégorisés</span>
                  </NameCell>
                  <SectionTotalsCells sec={sec} months={months} currentMonth={currentMonth} onSelect={onSelect} solde={solde.uncategorizedRunning ?? undefined} selCellKey={selCellKey} prevRowKey={prevSoldeRowKey.get(sectionRow("uncategorized"))} />
                </TableRow>
                {uOpen && sec.txns?.map((t) => (
                  <TxnRow key={t.id} txn={t} months={months} currentMonth={currentMonth} groups={groups} indent={1} onSelect={onSelect} selCellKey={selCellKey} />
                ))}
              </Fragment>
            );
          }
          return (
            <Fragment key={sec.kind}>
              <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                <TableCell className={cn("sticky left-0 z-10 p-0", MUTED40)}>
                  <FirstColBox>{sec.kind === "envelope" ? "Enveloppes" : "Récurrents"}</FirstColBox>
                </TableCell>
                <SectionTotalsCells sec={sec} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} />
              </TableRow>
              {sec.rows.map((r) => renderGroup(r))}
            </Fragment>
          );
        })}
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Solde actuel</FirstColBox>
          </TableCell>
          <GrandTotalsCells sections={sections} grand={grand} solde={solde} planned={planned} overspend={overspend} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} />
        </TableRow>
        {/* Estimé fin de mois : mois courant = solde projeté fin de mois
            (`forecast.currentEstimate`, distinct du solde « maintenant » sur la
            ligne « Solde actuel ») ; autres mois = leur solde de clôture (même
            détail que la ligne « Solde actuel » pour ce mois — cf. soldeActuelDetail). */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Estimé fin de mois</span></FirstColBox>
          </TableCell>
          {months.map((m, i) => {
            const isCurrent = m === currentMonth;
            const v = isCurrent ? forecast.currentEstimate : solde.closings[i];
            const detail: CellDetail = isCurrent
              ? makeDetail(
                  "Estimé fin de mois",
                  [
                    { label: "Solde actuel", amount: forecast.balance },
                    ...forecast.currentSteps.map((s) => ({ label: s.label, amount: s.amount })),
                  ],
                  { subtitle: monthLabel(m), result: forecast.currentEstimate },
                )
              : soldeActuelDetail(sections, solde, i, m, { title: "Estimé fin de mois", result: solde.closings[i] });
            const type = monthType(m, currentMonth);
            const cols = monthColumns(type);
            const estCell = (b: boolean) => (
              <CellAmount key="est" className={cn(b && "border-l", "text-right tabular-nums", v < -0.005 && "text-red-600")} detail={detail} onSelect={onSelect} cellKey={cellKey("estime", "solde", i)} selCellKey={selCellKey}>
                {fmt(v)}
              </CellAmount>
            );
            const slots = blankSlots();
            // En projection (pas de colonne Solde réel), l'estimé retombe sous « Solde prévu ».
            if (type === "future") slots.soldePrevu = estCell;
            else slots.soldeReel = estCell;
            return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
          })}
        </TableRow>
        {/* Dépassement : total des dépassements de budget (somme des Reste rouges). */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Dépassement</span></FirstColBox>
          </TableCell>
          {months.map((_, i) => {
            const month = months[i];
            const detail: CellDetail | null =
              overspend[i] > 0
                ? makeDetail(
                    "Dépassement",
                    sections
                      .flatMap((s) => s.rows)
                      .filter((r) => r.direction === "out" && r.cells[i].balance < 0)
                      .map((r): DetailNode => ({ label: r.name, amount: -r.cells[i].balance, ref: cellKey(groupRow(r.id), "reste", i) })),
                    { subtitle: monthLabel(month), result: overspend[i] },
                  )
                : null;
            const type = monthType(months[i], currentMonth);
            const cols = monthColumns(type);
            const depCell = (b: boolean) => (
              <CellAmount key="overspend" className={cn(b && "border-l", "text-right tabular-nums", overspend[i] > 0 && "text-red-600")} detail={detail} onSelect={onSelect} cellKey={cellKey("overspend", "reste", i)} selCellKey={selCellKey}>
                {overspend[i] > 0 ? fmt(overspend[i]) : "—"}
              </CellAmount>
            );
            const slots = blankSlots();
            // Sous la colonne Dépassement quand elle existe (courant / projection),
            // sinon sous Reste (mois passés).
            if (type === "past") slots.reste = depCell;
            else slots.depassement = depCell;
            return <Fragment key={i}>{cols.map((col, idx) => slots[col](idx === 0))}</Fragment>;
          })}
        </TableRow>
      </TableBody>
    </Table>
    </div>
  );
}
