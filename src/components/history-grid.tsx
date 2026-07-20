"use client";
import { Fragment, cloneElement, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/transactions-view";
import type { AccountForecast } from "@/lib/forecast";
import { type MonthCell, type HistorySection, type HistoryRow, type HistorySubRow, type HistoryTxn, type SoldeColumn, type PlannedSoldes, type RetainedOverspends, type PendingOverspend, uncatOverspend, computeTableEstimate } from "@/lib/history";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TruncatedText } from "@/components/truncated-text";
import { GroupSelectField } from "@/components/group-select-field";
import { overspendDecisionDetail } from "@/components/overspend-banner";
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
  makeInfo,
  txnNode,
} from "@/lib/history-explain";

// Décision déjà prise sur un dépassement (groupId, mois), telle que chargée en page
// (Task 4). groupId = 0 pour les non catégorisés.
type OverspendDecisionInfo = { groupId: number; month: string; decision: "exceptional" | "permanent" };

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

// Couleur d'un montant « Reste/Manque » : rouge s'il manque (négatif), vert sinon
// (reste positif ou à zéro).
function resteColor(v: number): string {
  return v < -0.005 ? "text-red-600" : "text-green-600";
}

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
  | "budgetRem" | "budgetDep" | "dep" | "recu" | "reste"
  | "soldeReel" | "soldePrevu" | "soldeDepass";

function monthType(m: string, currentMonth: string): MonthType {
  return m < currentMonth ? "past" : m === currentMonth ? "current" : "future";
}

function monthColumns(_type: MonthType): ColKey[] {
  // Vue uniforme : tous les mois (passés, courant, futurs) affichent les mêmes
  // colonnes et les mêmes calculs. Sur un mois futur, rien n'est encore réalisé
  // (Dép./Reçu à 0, Balance = budget entier) et les soldes repartent de l'estimé
  // de fin du mois courant. Le dépassement n'a pas de colonne : il se lit dans les
  // montants rouges de la Balance, totalisés sur la ligne « Dépassement hors
  // budget » en bas du tableau.
  return ["budgetRem", "budgetDep", "dep", "recu", "reste", "soldeReel", "soldePrevu", "soldeDepass"];
}

const COL_LABEL: Record<ColKey, string> = {
  budgetRem: "Budget rém.",
  budgetDep: "Budget dép.",
  dep: "Dép.",
  recu: "Reçu",
  reste: "Balance",
  soldeReel: "Solde réel",
  soldePrevu: "Solde prévu",
  soldeDepass: "Solde si dépassement",
};

function labelFor(col: ColKey, _type: MonthType): string {
  return COL_LABEL[col];
}

// Explication complète de chaque colonne, affichée dans le side panel quand on clique
// son en-tête (un paragraphe par entrée).
const COL_INFO: Record<ColKey, string[]> = {
  budgetRem: [
    "C'est l'argent que tu comptes recevoir ce mois-ci : tes rentrées d'argent. C'est une prévision, le montant que tu attends — pas encore celui qui est arrivé sur le compte. Ce qui est vraiment arrivé, tu le vois dans la colonne « Reçu » juste à côté.",
    "Tu peux avoir deux sortes de rentrées. Celle de tous les mois, ton revenu habituel : on la reporte sur tous les mois du tableau, parce qu'on sait qu'elle va revenir. Et une rentrée exceptionnelle, un coup de pouce que tu te verses quand le mois est serré : celle-là, on ne la compte que ce mois-ci, parce qu'on ne peut pas parier qu'elle reviendra.",
    "Par exemple : si d'habitude tu reçois 650 € et que ce mois-ci tu ajoutes 500 € exceptionnels, la case affiche 1 150 € ce mois-ci, mais elle repasse à 650 € les mois d'après.",
  ],
  budgetDep: [
    "C'est la limite que tu te fixes pour tes dépenses ce mois-ci : le « je ne veux pas dépenser plus que ça » de chaque poste. Juste à côté, « Dépensé » te dit combien tu as vraiment sorti, et « Reste/Manque » te dit s'il te reste de la marge ou si tu as débordé.",
    "Il y a deux genres de dépenses là-dedans. Celles qui tombent tous les mois, toujours pareilles, comme les abonnements, le loyer ou les impôts : tu connais le montant à l'avance. Et les enveloppes, une sorte de cagnotte que tu te donnes pour les postes qui bougent, comme les courses, les sorties ou l'essence.",
    "Cette case ne concerne que ce qui sort de ton compte. Pour l'argent qui rentre, c'est l'autre colonne, le budget rémunération, qui s'en occupe.",
    "Par exemple : 220 € de dépenses régulières plus 335 € d'enveloppes, ça fait un budget de dépenses de 555 € pour le mois.",
  ],
  dep: [
    "C'est l'argent qui est vraiment parti de ton compte ce mois-ci pour ce poste. Pas une prévision : le vrai, ce que tes achats t'ont coûté.",
    "À ne pas confondre avec le budget dépense, qui est ce que tu avais prévu de dépenser. En comparant les deux, tu vois d'un coup d'œil si tu es resté dans ton budget ou si tu l'as dépassé — c'est justement ce que t'affiche la colonne « Reste/Manque » juste après.",
    "Par exemple : si tu as payé 114 € d'abonnements et 100 € d'essence, ces montants s'additionnent dans ce que tu as dépensé sur le mois.",
  ],
  recu: [
    "C'est l'argent qui est vraiment arrivé sur ton compte ce mois-ci pour cette catégorie. Le vrai encaissement, pas la prévision.",
    "Ça n'a de sens que pour tes rentrées d'argent, comme ta paie ou un virement, et pour les opérations que tu n'as pas encore rangées dans une catégorie. Pour tes enveloppes et tes dépenses régulières, la case reste vide : ce sont des postes de dépense, tu n'y reçois jamais rien.",
    "Par exemple : tu attends 650 €. Tant qu'ils ne sont pas là, cette case affiche 0. Dès qu'ils tombent sur le compte, elle passe à 650 €.",
  ],
  reste: [
    "Ça répond à une question toute simple : sur ce budget, est-ce qu'il me reste de la marge, ou est-ce que j'ai trop dépensé ?",
    "Si le chiffre est positif, c'est ce qu'il te reste à dépenser avant d'épuiser le budget. S'il est négatif et en rouge, c'est que tu as dépensé plus que prévu, et le chiffre te dit de combien tu as débordé.",
    "Par exemple : un budget de 250 € où tu as dépensé 144 €, il te reste 106 €. Un budget de 85 € où tu as dépensé 100 €, tu es à −15 € : tu as débordé de 15 €.",
  ],
  soldeReel: [
    "C'est l'argent que tu as vraiment sur ton compte, reconstitué étape par étape.",
    "On part du vrai solde de ta banque aujourd'hui, et on remonte le fil des opérations pour retrouver où tu en étais à chaque mois. Chaque rentrée le fait monter, chaque dépense le fait descendre.",
    "C'est le chiffre le plus sûr, parce qu'il ne repose sur aucune supposition : que du réel. C'est ce qui le différencie des deux colonnes « Solde prévu » et « Solde si dépassement », qui sont des estimations.",
    "Pour les mois à venir, il n'y a pas encore de réel : la colonne prolonge alors l'estimé de fin du mois en cours, la meilleure idée qu'on ait de ce que sera vraiment ton compte.",
  ],
  soldePrevu: [
    "Ça répond à : combien me restera-t-il si je dépense pile ce que j'ai prévu, sans aucun dérapage ?",
    "On prend ce que tu as au départ, on ajoute ce que tu comptes recevoir, on enlève ce que tu comptes dépenser, et on enchaîne mois après mois : ce qui reste à la fin d'un mois devient ton point de départ pour le suivant.",
    "Sur le mois en cours, il peut être différent du solde réel. Le solde réel tient compte de ce que tu as déjà fait, alors que celui-ci applique ton plan en entier. Comparer les deux te dit si tu es en avance ou en retard sur ton plan.",
    "Par exemple : tu démarres à −120 €, tu attends 650 €, tu prévois 555 € de dépenses. Il te resterait −25 € en fin de mois.",
  ],
  soldeDepass: [
    "C'est l'hypothèse défavorable : où tu atterris si les dépassements que tu n'as pas encore tranchés se répètent chaque mois.",
    "Quand un budget déborde, l'app te demande de décider : exceptionnel (un accident, on arrête de le compter) ou permanent (ton budget monte, et c'est le Solde prévu qui l'absorbe). Tant que tu n'as pas décidé, le dépassement est reconduit ici, par prudence.",
    "L'écart entre « Solde prévu » et cette colonne mesure donc exactement ce qu'il te reste à trancher. Chaque décision le referme un peu ; quand tout est réglé, les deux colonnes disent la même chose.",
    "Sur les mois passés et le mois en cours, pas d'hypothèse : ce sont tes dépassements réels qui sont retirés.",
  ],
};

// Colonnes de solde (cumulé, se traîne de mois en mois) : teintées et séparées du
// détail du mois par une bordure gauche plus marquée sur la première d'entre elles.
const SOLDE_COLS_SET = new Set<ColKey>(["soldeReel", "soldePrevu", "soldeDepass"]);
const SOLDE_TINT = "bg-[color-mix(in_oklab,var(--primary)_5%,var(--background))]";
const SOLDE_SEP = "border-l-2 border-l-muted-foreground/25";
// Teinte de fond de la colonne Balance (ex-« Reste/Manque ») : un ambré doux qui
// la distingue de la bande grise des soldes.
const BALANCE_TINT = "bg-[color-mix(in_oklab,oklch(0.75_0.16_80)_16%,var(--background))]";

// Rend les cellules d'un mois (une par colonne) et ajoute la bordure de séparation
// sur la première colonne de solde. La teinte de fond des colonnes de solde est
// posée par le <colgroup> du tableau (elle passe sous le fond des lignes de total,
// donc la bande s'interrompt proprement sur les lignes grises).
function renderCols(cols: ColKey[], slots: Record<ColKey, (b: boolean) => React.ReactNode>): React.ReactNode[] {
  const firstSolde = cols.find((c) => SOLDE_COLS_SET.has(c));
  return cols.map((col, idx) => {
    const cell = slots[col](idx === 0);
    if (col !== firstSolde || !isValidElement(cell)) return cell;
    const el = cell as React.ReactElement<{ className?: string }>;
    return cloneElement(el, { className: cn(el.props.className, SOLDE_SEP) });
  });
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
    budgetRem: (b) => blankCol("budgetRem", b),
    budgetDep: (b) => blankCol("budgetDep", b),
    dep: (b) => blankCol("dep", b),
    recu: (b) => blankCol("recu", b),
    reste: (b) => blankCol("reste", b),
    soldeReel: (b) => blankCol("soldeReel", b),
    soldePrevu: (b) => blankCol("soldePrevu", b),
    soldeDepass: (b) => blankCol("soldeDepass", b),
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
  selCellKey?: ReadonlySet<string>;
}) {
  const cls = cn(className, ck != null && selCellKey?.has(ck) && CELL_HL);
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
  selCellKey?: ReadonlySet<string>,
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
  // Pour un « net », la colonne suit le sens du groupe (Reçu pour une entrée, Dép.
  // pour une dépense), même à 0 — netCol retomberait sur Dép. pour une entrée vide.
  const netColOf = r.direction === "in" ? "recu" : r.direction === "out" ? "depense" : netCol(c);
  return {
    label: r.name,
    amount,
    children: kind === "budget" ? undefined : txnChildren(r, month, sign, i),
    ref: cellKey(groupRow(r.id), kind === "net" ? netColOf : colOf(kind, c), i),
  };
}

// Inverse un nœud (et ses enfants), pour transformer un nœud « Dépensé » positif
// (utilisé tel quel dans une colonne Dépensé) en sous-nœud négatif d'un « Reste ».
function negateNode(n: DetailNode): DetailNode {
  return { ...n, amount: -n.amount, children: n.children?.map(negateNode) };
}

// Revenu projeté d'une ligne pour un mois (même règle que la chaîne « solde prévu » :
// principale tous mois, supplémentaire au mois courant seulement, 0 pour une dépense).
function rowProjRevenu(r: HistoryRow, i: number, isCurrent: boolean): number {
  if (r.direction !== "in") return 0;
  if (r.incomeKind === "supplementary") return isCurrent ? r.cells[i].budgeted : 0;
  return r.cells[i].budgeted;
}

// Décompose un « Dépassement cumulé » : un nœud négatif par groupe qui dépasse,
// pointant vers la case Balance de ce groupe (le montant rouge d'où vient le
// dépassement). Le total (négatif) est ce qui se soustrait du solde prévu.
function overspendChildren(rows: { id: number; name: string; amount: number }[], i: number): DetailNode[] {
  return rows.map((g) => ({ label: g.name, amount: -g.amount, ref: cellKey(groupRow(g.id), "reste", i) }));
}

// Clé de ligne d'une section pour les data-cellkey. Les deux sections « non
// catégorisés » (reçus / dépenses) ont chacune la leur.
function sectionRowKey(sec: HistorySection): string {
  return sec.kind === "uncategorized" && sec.uncatDirection === "in" ? "section:uncat-in" : sectionRow(sec.kind);
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
  return { label: labelOfSection(sec.kind), amount, children, ref: cellKey(sectionRowKey(sec), colOf(kind, t), i) };
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
function AmountCells({ cells, mode, solde, soldePrevu, soldeDepass, onSelect, subtitleOf, detailRow, months, currentMonth, rowKey, selCellKey, prevRowKey, incomeKind, depassCumulRows, accountId, decisionByKey }: {
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
  selCellKey?: ReadonlySet<string>;
  // Ligne dont le solde est le « Solde précédent » de celle-ci (prédécesseur dans
  // l'accumulation) : pour surligner sa case Solde depuis le side panel.
  prevRowKey?: string;
  // Classe de revenu (pour les colonnes Budg./Revenus des rémunérations).
  incomeKind?: "principal" | "supplementary" | null;
  // Dépassements (par groupe) cumulés jusqu'à cette ligne incluse, un tableau par
  // mois, pour décomposer le « Dépassement cumulé » du solde si dépassement.
  // Absent pour les sous-lignes.
  depassCumulRows?: { id: number; name: string; amount: number }[][];
  // Compte courant et décisions déjà prises : pour attacher le bloc de décision
  // (overspendAction) sur la Balance d'une ligne de groupe en dépassement. Absents
  // pour les sous-lignes (pas d'action sur un poste).
  accountId?: string;
  decisionByKey?: Map<string, "exceptional" | "permanent">;
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

        // Dép. affiche c.depense sauf pour une entrée (—) : cliquable même à 0,00,
        // avec les transactions du mois si présentes, sinon aucune décomposition.
        const depDetail: CellDetail | null =
          mode !== "in" && r
            ? makeDetail("Dépensé", txnChildren(r, month, 1, i) ?? [], { subtitle, result: c.depense })
            : null;

        // Reçu affiche c.recu sauf pour une dépense (—) : cliquable même à 0,00.
        const recuDetail: CellDetail | null =
          mode !== "out" && r
            ? makeDetail("Reçu", txnChildren(r, month, 1, i) ?? [], { subtitle, result: c.recu })
            : null;

        // Reste affiche c.balance sauf pour une entrée (case vide) : cliquable même à
        // 0,00. Décomposition Budget − Dépensé quand l'invariant tient, sinon aucune.
        const resteDetail: CellDetail | null =
          mode !== "in" && r
            ? makeDetail(
                "Reste",
                Math.abs(c.budgeted - c.depense - c.balance) < 0.005
                  ? [
                      { label: "Budget", amount: c.budgeted, ref: ck("budget") },
                      { label: "Dépensé", amount: -c.depense, children: txnChildren(r, month, -1, i), ref: ck("depense") },
                    ]
                  : [],
                { subtitle, result: c.balance },
              )
            : null;
        // Bloc de décision : uniquement sur une Balance en dépassement d'un mois
        // passé ou courant (les mois futurs n'ont rien de réel à trancher).
        if (resteDetail && mode === "out" && month <= currentMonth && c.balance < -0.005 && r && accountId) {
          resteDetail.overspendAction = {
            accountId,
            groupId: r.id,
            groupName: r.name,
            month,
            amount: -c.balance,
            decision: decisionByKey?.get(`${r.id}::${month}`) ?? null,
            currentBudget: c.budgeted,
          };
        }

        const s = solde?.[i];
        const net = c.recu - c.depense;
        // Solde précédent = solde de cette ligne − son propre mouvement.
        const soldeDetail: CellDetail | null =
          s != null && r
            ? makeDetail(
                "Solde",
                [
                  { label: "Solde précédent", amount: s - net, ref: prevRowKey ? cellKey(prevRowKey, "solde", i) : undefined },
                  // Le mouvement d'une entrée vit dans la colonne Reçu, celui d'une
                  // dépense dans Dép. — même quand le montant est encore à 0 (netCol
                  // retomberait alors sur Dép., faux pour une rémunération).
                  { label: "Mouvement du mois", amount: net, children: txnChildren(r, month, net < 0 ? -1 : 1, i), ref: ck(mode === "in" ? "recu" : mode === "out" ? "depense" : netCol(c)) },
                ],
                { subtitle, result: s },
              )
            : null;

        // --- Détails des colonnes de projection (mois courant / futurs) ---------
        const isCurrent = month === currentMonth;

        // Budget rémunération (ce qui rentre) : montant de la rémunération. Principale
        // sur tous les mois ; supplémentaire au mois courant seulement (— sinon, non
        // projetée) ; — pour une dépense. Clé de case « revenus ».
        const budgetRemVal: number | null =
          mode === "in" ? (incomeKind === "supplementary" ? (isCurrent ? c.budgeted : null) : c.budgeted) : null;
        const budgetRemDetail: CellDetail | null =
          budgetRemVal != null && r
            ? makeDetail("Budget rémunération", [{ label: r.name, amount: budgetRemVal, ref: ck("revenus") }], { subtitle, result: budgetRemVal })
            : null;

        // Budget dépense (ce qui sort) : budget d'enveloppe / récurrent ; — pour une
        // entrée. Postes du récurrent si présents, sinon un nœud unique (enveloppe).
        const budgetDepVal: number | null = mode === "out" ? c.budgeted : null;
        const budgetDepDetail: CellDetail | null =
          budgetDepVal != null && r
            ? makeDetail("Budget dépense", budgetNodes(r, i) ?? [{ label: r.name, amount: c.budgeted, ref: ck("budget") }], { subtitle, result: c.budgeted })
            : null;

        // Mouvement prévu du mois de cette ligne = revenus projeté − budget (même
        // net que la chaîne « solde prévu »).
        const revenusProj = mode === "in" ? (incomeKind === "supplementary" ? (isCurrent ? c.budgeted : 0) : c.budgeted) : 0;
        const budgetProj = mode === "out" ? c.budgeted : 0;
        const mouvementPrevu = revenusProj - budgetProj;
        // Décomposition du mouvement prévu : pour une dépense, les postes du budget
        // (négatifs) ; pour une entrée, le revenu projeté. Chaque enfant pointe vers
        // sa case, pour tracer d'où vient le montant.
        const mouvementChildren: DetailNode[] =
          mode === "out" && r
            ? (budgetNodes(r, i)?.map(negateNode) ?? [{ label: r.name, amount: -c.budgeted, ref: ck("budget") }])
            : mode === "in" && r
              ? [{ label: r.name, amount: revenusProj, ref: ck("revenus") }]
              : [];
        const sp = soldePrevu?.[i];
        const soldePrevuDetail: CellDetail | null =
          sp != null && r
            ? makeDetail(
                "Solde prévu",
                [
                  { label: "Solde prévu précédent", amount: sp - mouvementPrevu, ref: prevRowKey ? cellKey(prevRowKey, "soldePrevu", i) : undefined },
                  { label: "Mouvement prévu du mois", amount: mouvementPrevu, ref: mode === "out" ? ck("budget") : mode === "in" ? ck("revenus") : undefined, children: mouvementChildren.length ? mouvementChildren : undefined },
                ],
                { subtitle, result: sp },
              )
            : null;
        const sd = soldeDepass?.[i];
        // Les montants du « Dépassement cumulé » viennent des dépassements retenus
        // (non tranchés) sur les mois futurs, ou des dépassements réels du mois courant
        // et passés ; les renvois pointent vers les cases Balance du mois affiché :
        // la surbrillance reste dans la colonne du mois cliqué.
        const soldeDepassDetail: CellDetail | null =
          sd != null && sp != null && r
            ? makeDetail(
                "Solde si dépassement",
                [
                  { label: "Solde prévu", amount: sp, ref: ck("soldePrevu") },
                  // Dépassement cumulé = somme des dépassements de budget maintenus,
                  // décomposé par groupe (jusqu'à cette ligne incluse). La somme
                  // n'existe pas telle quelle dans le tableau : on surligne ensemble
                  // les cases Balance qui la composent (refs).
                  {
                    label: "Dépassement cumulé",
                    amount: -(sp - sd),
                    refs: (depassCumulRows?.[i] ?? []).map((g) => cellKey(groupRow(g.id), "reste", i)),
                    children: overspendChildren(depassCumulRows?.[i] ?? [], i),
                  },
                ],
                { subtitle, result: sd },
              )
            : null;

        // Colonnes réelles : cliquables (détail + surbrillance) comme avant.
        // Colonnes de projection : désormais cliquables aussi (détail + clé de case).
        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budgetRem: (b) => (
            <CellAmount key="budgetRem" className={cn(b && "border-l", "text-right tabular-nums")} detail={budgetRemDetail} onSelect={onSelect} cellKey={ck("revenus")} selCellKey={selCellKey}>
              {budgetRemVal != null ? fmt(budgetRemVal) : "—"}
            </CellAmount>
          ),
          budgetDep: (b) => (
            <CellAmount key="budgetDep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={budgetDepDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {budgetDepVal != null ? fmt(budgetDepVal) : "—"}
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
            <CellAmount key="reste" className={cn(b && "border-l", "text-right tabular-nums", mode !== "in" && resteColor(c.balance))} detail={resteDetail} onSelect={onSelect} cellKey={ck("reste")} selCellKey={selCellKey}>
              {mode === "in" ? "" : fmt(c.balance)}
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

        return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
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
function SectionTotalsCells({ sec, months, currentMonth, onSelect, solde, planPrevu, planDepass, uncatInSec, selCellKey, prevRowKey, retained, accountId, decisionByKey }: {
  sec: HistorySection;
  months: string[];
  currentMonth: string;
  onSelect?: (d: CellDetail) => void;
  solde?: (number | null)[];
  // Soldes du plan (prévu / si dépassement) au niveau de cette ligne, pour les non
  // catégorisés : ils ne sont pas planifiés, donc le solde du plan les traverse
  // (les reçus reprennent la valeur après les rémunérations, les dépenses la
  // clôture du plan).
  planPrevu?: (number | null)[];
  planDepass?: (number | null)[];
  // Section « non catégorisés » côté reçus : fournie à la section côté dépenses
  // pour calculer sa Balance (Reçu de la ligne du haut − Dépensé de celle-ci).
  uncatInSec?: HistorySection;
  selCellKey?: ReadonlySet<string>;
  // Ligne dont le solde est le « Solde précédent » de cette section (prédécesseur).
  prevRowKey?: string;
  // Dépassement non catégorisés retenu (non tranché) : reconduit sur les mois
  // futurs à la place du dépassement du mois courant (cf. Task 4).
  retained?: RetainedOverspends;
  // Compte courant et décisions déjà prises : pour attacher le bloc de décision sur
  // la Balance non catégorisés en dépassement (section « out » uniquement).
  accountId?: string;
  decisionByKey?: Map<string, "exceptional" | "permanent">;
}) {
  const isUncat = sec.kind === "uncategorized";
  // Section « non catégorisés » côté reçus (affichée sous les rémunérations).
  const uncatIn = isUncat && sec.uncatDirection === "in";
  const rowKey = sectionRowKey(sec);
  return (
    <>
      {sec.totals.map((c, i) => {
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = `${labelOfSection(sec.kind)} · ${monthLabel(month)}`;
        const ck = (col: Col) => cellKey(rowKey, col, i);

        // Budg. affiche toujours un nombre → toujours cliquable (décomposition par
        // groupe, éventuellement vide pour les non catégorisés qui n'ont pas de budget).
        const budgetDetail: CellDetail =
          makeDetail("Budget", sec.rows.map((r) => groupNode(r, i, month, "budget")), { subtitle, result: c.budgeted });

        const depNodes = isUncat
          ? sectionTxnChildren(sec.txns, month, true, i)
          : sec.rows.map((r) => groupNode(r, i, month, "depense")).filter((n) => n.amount !== 0);
        const depDetail: CellDetail = makeDetail("Dépensé", depNodes ?? [], { subtitle, result: c.depense });

        const recuNodes = isUncat
          ? sectionTxnChildren(sec.txns, month, false, i)
          : sec.rows.map((r) => groupNode(r, i, month, "recu")).filter((n) => n.amount !== 0);
        const recuDetail: CellDetail = makeDetail("Reçu", recuNodes ?? [], { subtitle, result: c.recu });

        // Balance des non catégorisés (côté dépenses) : le mouvement net = Reçu de
        // la ligne « Non catégorisés » du haut (reçus) − Dépensé de celle-ci.
        const inRecu = uncatInSec?.totals[i]?.recu ?? 0;
        const inRecuNodes = uncatInSec ? sectionTxnChildren(uncatInSec.txns, month, false, i) : undefined;
        const resteVal = isUncat ? c.budgeted + inRecu - c.depense : c.balance;
        // Balance toujours affichée → toujours cliquable. Décomposition : Reçu (ligne
        // des reçus non catégorisés) − Dépensé pour les non catégorisés, Budget −
        // Dépensé pour les autres sections (quand l'invariant tient).
        const resteDetail: CellDetail = makeDetail(
          "Balance",
          isUncat
            ? [
                {
                  label: "Reçu",
                  amount: inRecu,
                  ref: uncatInSec ? cellKey(sectionRowKey(uncatInSec), "recu", i) : undefined,
                  children: inRecuNodes ?? undefined,
                },
                {
                  label: "Dépensé",
                  amount: -c.depense,
                  ref: ck("depense"),
                  children: (depNodes ?? []).map(negateNode),
                },
              ]
            : Math.abs(c.budgeted - c.depense - c.balance) < 0.005
              ? [
                  { label: "Budget", amount: c.budgeted, ref: ck("budget") },
                  {
                    label: "Dépensé",
                    amount: -c.depense,
                    ref: ck("depense"),
                    children: (depNodes ?? []).map(negateNode),
                  },
                ]
              : [],
          { subtitle, result: resteVal },
        );
        // Bloc de décision : uniquement la section Non catégorisés « out », en
        // dépassement, sur un mois passé ou courant. Pas d'option « permanent »
        // (currentBudget: null — les non catégorisés n'ont pas de budget).
        if (isUncat && !uncatIn && resteVal < -0.005 && month <= currentMonth && accountId) {
          resteDetail.overspendAction = {
            accountId,
            groupId: 0,
            groupName: "Non catégorisés",
            month,
            amount: -resteVal,
            decision: decisionByKey?.get(`0::${month}`) ?? null,
            currentBudget: null,
          };
        }

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

        // Dépassement des non catégorisés = la part rouge de leur Balance (dépensé
        // au-delà des reçus non catégorisés). Sert au calcul du solde si dépassement.
        // Mois futur : le dépassement retenu (non tranché) si fourni, sinon repli sur
        // celui du mois courant, maintenu.
        const ciIdx = months.indexOf(currentMonth);
        const isFuture = month > currentMonth;
        const srcI = isFuture && ciIdx !== -1 ? ciIdx : i;
        const cDep = sec.totals[srcI];
        const inRecuSrc = uncatInSec?.totals[srcI]?.recu ?? 0;
        const currentDepassVal = Math.max(0, cDep.depense - inRecuSrc - cDep.budgeted);
        const depassVal = isUncat && !uncatIn ? (isFuture ? retained?.uncat ?? currentDepassVal : currentDepassVal) : 0;

        // Non catégorisés comme étape du plan : planPrevu/planDepass fournissent les
        // valeurs courues à cette ligne (le débordement net est déjà retiré de la
        // chaîne « si dépassement » — cf. computePlannedSoldes). Le détail repose le
        // calcul : valeur précédente (au-dessus) − dépassement de la ligne.
        const soldePrevuVal = planPrevu?.[i] ?? null;
        const soldeDepassVal = planDepass?.[i] ?? null;
        const soldePrevuDetail: CellDetail | null =
          isUncat && soldePrevuVal != null
            ? makeDetail(
                "Solde prévu",
                [
                  { label: "Solde prévu précédent", amount: soldePrevuVal + c.budgeted, ref: prevRowKey ? cellKey(prevRowKey, "soldePrevu", i) : undefined },
                  { label: "Budget dépense", amount: -c.budgeted, ref: ck("budget") },
                ],
                { subtitle, result: soldePrevuVal },
              )
            : null;
        const soldeDepassDetail: CellDetail | null =
          isUncat && soldeDepassVal != null
            ? makeDetail(
                "Solde si dépassement",
                [
                  { label: "Solde si dépassement précédent", amount: soldeDepassVal + depassVal, ref: prevRowKey ? cellKey(prevRowKey, "soldeDepass", i) : undefined },
                  // Dépassement retenu (non tranché) sur les mois futurs, sinon celui du mois courant, renvoi vers la Balance du mois affiché.
                  { label: "Dépassement", amount: -depassVal, ref: cellKey(rowKey, "reste", i) },
                ],
                { subtitle, result: soldeDepassVal },
              )
            : null;

        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budgetRem: (b) => (
            <TableCell key="budgetRem" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
          ),
          // Les non catégorisés n'ont pas de budget : « — » (les deux lignes).
          budgetDep: (b) =>
            isUncat ? (
              <TableCell key="budgetDep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
            ) : (
              <CellAmount key="budgetDep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={budgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
                {fmt(c.budgeted)}
              </CellAmount>
            ),
          dep: (b) =>
            uncatIn ? (
              <TableCell key="dep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
            ) : (
              <CellAmount key="dep" className={cn(b && "border-l", "text-right tabular-nums")} detail={depDetail} onSelect={onSelect} cellKey={ck("depense")} selCellKey={selCellKey}>
                {fmt(c.depense)}
              </CellAmount>
            ),
          // Seuls les non catégorisés côté reçus encaissent : les sections de dépense
          // (Récurrents / Enveloppes / non catégorisés côté dépenses) affichent « — ».
          recu: (b) =>
            uncatIn ? (
              <CellAmount key="recu" className={cn(b && "border-l", "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={ck("recu")} selCellKey={selCellKey}>
                {fmt(c.recu)}
              </CellAmount>
            ) : (
              <TableCell key="recu" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
            ),
          // Balance : affichée seulement pour les non catégorisés côté dépenses (les
          // reçus n'ont pas de budget à confronter ; Récurrents / Enveloppes ont leurs
          // lignes « Balance ... » dédiées).
          reste: (b) =>
            isUncat && !uncatIn ? (
              <CellAmount key="reste" className={cn(b && "border-l", "text-right tabular-nums", resteColor(resteVal))} detail={resteDetail} onSelect={onSelect} cellKey={ck("reste")} selCellKey={selCellKey}>
                {fmt(resteVal)}
              </CellAmount>
            ) : (
              blankCol("reste", b)
            ),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && "border-l", "text-right tabular-nums", s != null && s < -0.005 && "text-red-600")} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {s != null ? fmt(s) : ""}
            </CellAmount>
          ),
          // Non catégorisés : on affiche le solde du plan (identique aux clôtures
          // prévues du mois) ; les autres sections de dépense restent vides.
          soldePrevu: (b) =>
            isUncat
              ? plannedSoldeCell("soldePrevu", soldePrevuVal, b, soldePrevuDetail, onSelect, ck("soldePrevu"), selCellKey)
              : plannedSoldeCol("soldePrevu", null, b),
          soldeDepass: (b) =>
            isUncat
              ? plannedSoldeCell("soldeDepass", soldeDepassVal, b, soldeDepassDetail, onSelect, ck("soldeDepass"), selCellKey)
              : plannedSoldeCol("soldeDepass", null, b),
        };

        return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
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
  selCellKey?: ReadonlySet<string>;
}) {
  return (
    <>
      {sec.totals.map((c, i) => {
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = `Rémunérations · ${monthLabel(month)}`;
        // Reçu toujours affiché → toujours cliquable (décomposition par rémunération).
        const recuDetail: CellDetail = makeDetail(
          "Rémunérations",
          sec.rows.map((r) => groupNode(r, i, month, "recu")).filter((n) => n.amount !== 0),
          { subtitle, result: c.recu },
        );
        // Budget rémunération total = somme des rémunérations affichées (principale
        // tous mois, supplémentaire au mois courant seulement), décomposé par ligne.
        const isCur = month === currentMonth;
        const budgetRemTotal = sec.rows.reduce((s, r) => s + rowProjRevenu(r, i, isCur), 0);
        const budgetRemNodes = sec.rows
          .map((r): DetailNode => ({ label: r.name, amount: rowProjRevenu(r, i, isCur), ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const budgetRemDetail: CellDetail = makeDetail("Budget rémunération", budgetRemNodes, { subtitle, result: budgetRemTotal });

        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budgetRem: (b) => (
            <CellAmount key="budgetRem" className={cn(b && "border-l", "text-right tabular-nums")} detail={budgetRemDetail} onSelect={onSelect} cellKey={cellKey(sectionRow("income"), "revenus", i)} selCellKey={selCellKey}>
              {fmt(budgetRemTotal)}
            </CellAmount>
          ),
          budgetDep: (b) => (
            <TableCell key="budgetDep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")}>—</TableCell>
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
          soldeReel: (b) => blankCol("soldeReel", b),
          soldePrevu: (b) => blankCol("soldePrevu", b),
          soldeDepass: (b) => blankCol("soldeDepass", b),
        };

        return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
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
function GrandTotalsCells({ sections, grand, solde, planned, overspend, months, currentMonth, currentEstimate, onSelect, selCellKey, retained }: {
  sections: HistorySection[];
  grand: MonthCell[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  overspend: number[];
  months: string[];
  currentMonth: string;
  // Estimé de fin du mois courant : point de départ des chaînes de plan du premier
  // mois futur (cf. computePlannedSoldes).
  currentEstimate?: number;
  onSelect?: (d: CellDetail) => void;
  selCellKey?: ReadonlySet<string>;
  // Dépassements retenus (non tranchés) : reconduits sur les mois futurs à la place
  // des dépassements réels du mois courant (cf. Task 4).
  retained?: RetainedOverspends;
}) {
  return (
    <>
      {grand.map((c, i) => {
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = monthLabel(month);
        const ck = (col: Col) => cellKey("grand", col, i);
        // Budget rémunération total = somme des rémunérations affichées (principale
        // tous mois, supplémentaire au mois courant seulement).
        const isCur = month === currentMonth;
        const allRows = sections.flatMap((s) => s.rows);
        const budgetRemTotal = allRows.reduce((a, r) => a + rowProjRevenu(r, i, isCur), 0);

        // Budget des dépenses seulement (enveloppes + récurrents, hors rémunérations).
        const expenseBudget = sections.reduce((s, sec) => s + (sec.kind === "income" ? 0 : sec.totals[i].budgeted), 0);

        // Dép./Reçu/Reste du grand total : toujours un nombre affiché → toujours
        // cliquables (décomposition par section, éventuellement vide).
        const depDetail: CellDetail = makeDetail(
          "Dépensé",
          sections.map((sec) => sectionNode(sec, i, month, "depense")).filter((n) => n.amount !== 0),
          { subtitle, result: c.depense },
        );
        const recuDetail: CellDetail = makeDetail(
          "Reçu",
          sections.map((sec) => sectionNode(sec, i, month, "recu")).filter((n) => n.amount !== 0),
          { subtitle, result: c.recu },
        );
        // Reste : non affiché sur la ligne « Solde actuel » (grand total) — un reste
        // agrégé toutes catégories confondues n'est pas parlant.
        const soldeDetail: CellDetail = soldeActuelDetail(sections, solde, i, month, { title: "Solde actuel", result: solde.closings[i] });

        // --- Détails des colonnes de projection du grand total ------------------
        // Budget de projection : seules les sections de dépense (cohérent avec la
        // valeur affichée expenseBudget, qui exclut les rémunérations).
        const expenseBudgetDetail: CellDetail =
          makeDetail("Budget", sections.filter((sec) => sec.kind !== "income").map((sec) => sectionNode(sec, i, month, "budget")), { subtitle, result: expenseBudget });
        // Détail du budget rémunération : un nœud par rémunération affichée.
        const budgetRemNodes = allRows
          .filter((r) => r.direction === "in")
          .map((r): DetailNode => ({ label: r.name, amount: rowProjRevenu(r, i, isCur), ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const budgetRemDetail: CellDetail = makeDetail("Budget rémunération", budgetRemNodes, { subtitle, result: budgetRemTotal });
        // Mois de référence des dépassements maintenus (mois courant en projection).
        const ciIdx = months.indexOf(currentMonth);
        const cs = month <= currentMonth || ciIdx === -1 ? i : ciIdx;
        // Soldes de plan (prévu / si dépassement) : structure « précédent + mouvement ».
        // Le « précédent » = l'ouverture réelle du mois (passé / courant, où le plan
        // s'ancre), ou la clôture prévue du mois passé (futur). Le mouvement =
        // clôture − précédent (exact par défaut).
        const prevuClose = planned.prevuClosings[i];
        const depassClose = planned.depassClosings[i];
        // Premier mois futur : la chaîne du plan repart de l'estimé de fin du mois courant.
        const firstFuture = month > currentMonth && i > 0 && months[i - 1] === currentMonth;
        const prevuPrev =
          month <= currentMonth ? solde.openings[i]
          : firstFuture && currentEstimate != null ? currentEstimate
          : i > 0 && planned.prevuClosings[i - 1] != null ? planned.prevuClosings[i - 1]! : solde.openings[i];
        // Décomposition du mouvement prévu du mois = revenus prévus − budget de dépenses.
        const revenusChildren = allRows
          .filter((r) => r.direction === "in")
          .map((r): DetailNode => ({ label: r.name, amount: rowProjRevenu(r, i, isCur), ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const budgetChildren = sections
          .filter((sec) => sec.kind !== "income")
          .map((sec) => negateNode(sectionNode(sec, i, month, "budget")))
          .filter((n) => n.amount !== 0);
        const mouvementPrevuNode: DetailNode = {
          label: "Mouvement prévu du mois",
          amount: prevuClose != null ? prevuClose - prevuPrev : 0,
          children: [
            { label: "Revenus prévus", amount: budgetRemTotal, ref: ck("revenus"), children: revenusChildren },
            { label: "Budget", amount: -expenseBudget, ref: ck("budget"), children: budgetChildren },
          ],
        };
        const soldePrevuDetail: CellDetail | null =
          prevuClose != null
            ? makeDetail(
                "Solde prévu",
                [
                  {
                    label: firstFuture ? "Estimé fin du mois précédent" : "Solde prévu précédent",
                    amount: prevuPrev,
                    ref:
                      month <= currentMonth ? cellKey(openingRow, "soldePrevu", i)
                      : firstFuture ? cellKey("estime", "solde", i - 1)
                      : cellKey("grand", "soldePrevu", i - 1),
                  },
                  mouvementPrevuNode,
                ],
                { subtitle, result: prevuClose },
              )
            : null;
        // Dépassement cumulé du grand total = dépassement total maintenu, décomposé
        // par groupe. Mois passés/courant : montants réels du mois affiché. Mois
        // futurs : dépassements retenus (non tranchés) si fournis, sinon repli sur
        // ceux du mois courant (cf. cs). Les renvois pointent toujours vers les cases
        // Balance du mois affiché : la surbrillance reste dans la colonne du mois cliqué.
        const isFuture = month > currentMonth;
        const uncatOs = isFuture ? retained?.uncat ?? uncatOverspend(sections, cs) : uncatOverspend(sections, cs);
        const overspendRows: { id: number; name: string; amount: number }[] =
          isFuture && retained
            ? allRows
                .filter((r) => r.direction === "out" && (retained.byGroup[r.id] ?? 0) > 0.005)
                .map((r) => ({ id: r.id, name: r.name, amount: -(retained.byGroup[r.id] ?? 0) }))
            : allRows
                .filter((r) => r.direction === "out" && r.cells[cs].balance < 0)
                .map((r) => ({ id: r.id, name: r.name, amount: r.cells[cs].balance }));
        const grandOverspendChildren: DetailNode[] = [
          ...overspendRows.map((r): DetailNode => ({ label: r.name, amount: r.amount, ref: cellKey(groupRow(r.id), "reste", i) })),
          // Débordement net des non catégorisés (dépensé au-delà des reçus), inclus
          // dans la chaîne « si dépassement » comme les dépassements de budget.
          ...(uncatOs > 0.005
            ? [{ label: "Non catégorisés", amount: -uncatOs, ref: cellKey(sectionRow("uncategorized"), "reste", i) }]
            : []),
        ];
        const soldeDepassDetail: CellDetail | null =
          depassClose != null && prevuClose != null
            ? makeDetail(
                "Solde si dépassement",
                [
                  { label: "Solde prévu", amount: prevuClose, ref: ck("soldePrevu") },
                  // La somme n'existe pas telle quelle : surligner ensemble les cases
                  // Balance rouges qui la composent.
                  {
                    label: "Dépassement cumulé",
                    amount: -(prevuClose - depassClose),
                    refs: grandOverspendChildren.map((n) => n.ref!).filter(Boolean),
                    children: grandOverspendChildren,
                  },
                ],
                { subtitle, result: depassClose },
              )
            : null;

        const slots: Record<ColKey, (border: boolean) => React.ReactNode> = {
          budgetRem: (b) => (
            <CellAmount key="budgetRem" className={cn(b && "border-l", "text-right tabular-nums")} detail={budgetRemDetail} onSelect={onSelect} cellKey={ck("revenus")} selCellKey={selCellKey}>
              {fmt(budgetRemTotal)}
            </CellAmount>
          ),
          budgetDep: (b) => (
            <CellAmount key="budgetDep" className={cn(b && "border-l", "text-right tabular-nums text-muted-foreground")} detail={expenseBudgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {fmt(expenseBudget)}
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
          reste: (b) => blankCol("reste", b),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && "border-l", "text-right tabular-nums", solde.closings[i] < -0.005 && "text-red-600")} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {fmt(solde.closings[i])}
            </CellAmount>
          ),
          soldePrevu: (b) => plannedSoldeCell("soldePrevu", planned.prevuClosings[i], b, soldePrevuDetail, onSelect, ck("soldePrevu"), selCellKey),
          soldeDepass: (b) => plannedSoldeCell("soldeDepass", planned.depassClosings[i], b, soldeDepassDetail, onSelect, ck("soldeDepass"), selCellKey),
        };

        return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
      })}
    </>
  );
}

// Cellules d'une transaction : son montant tombe dans la colonne Dép. (sortie)
// ou Reçu (entrée), selon son signe, du mois où elle a lieu ; le reste est vide.
function TxnCells({ txn, months, currentMonth, onSelect, selCellKey }: { txn: HistoryTxn; months: string[]; currentMonth: string; onSelect?: (d: CellDetail) => void; selCellKey?: ReadonlySet<string> }) {
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
          budgetRem: (b) => blankCol("budgetRem", b),
          budgetDep: (b) => blankCol("budgetDep", b),
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
          soldeReel: (b) => blankCol("soldeReel", b),
          soldePrevu: (b) => blankCol("soldePrevu", b),
          soldeDepass: (b) => blankCol("soldeDepass", b),
        };
        return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
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
  selCellKey?: ReadonlySet<string>;
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

// Ligne d'espacement entre deux sections : une bande vide de faible hauteur qui
// couvre toutes les colonnes, pour aérer visuellement sans ajouter de contenu.
function SpacerRow({ cols }: { cols: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={cols} className="h-8 border-0 p-0" />
    </TableRow>
  );
}

// Premier ancêtre réellement défilant sur un axe (x = horizontal, y = vertical).
// Sert à amener une case dans la vue sans scrollIntoView (qui ne tient pas compte
// de la colonne collante et défile parfois le mauvais conteneur).
function scrollableAncestor(el: HTMLElement, axis: "x" | "y"): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    const scrollable =
      axis === "x" ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight;
    if ((overflow === "auto" || overflow === "scroll") && scrollable) return node;
    node = node.parentElement;
  }
  return null;
}

export function HistoryGrid({ months, currentMonth, forecast, sections, overspend, grand, groups, solde, planned, retained, onSelect, selected, anchor, accountId, decisions, pendingClosed, currentBudgets }: {
  months: string[];
  currentMonth: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  // Dépassements retenus (non tranchés) par groupe et pour les non catégorisés :
  // ce que les mois futurs de la chaîne « si dépassement » reconduisent (cf. Task 4).
  retained?: RetainedOverspends;
  // Clic sur un montant : remonté au parent, qui l'affiche dans la sidebar.
  onSelect: (d: CellDetail) => void;
  // Cases actives choisies depuis le side panel (clés data-cellkey, null = aucune).
  // Plusieurs quand la ligne cliquée du panneau est une somme éclatée dans le tableau.
  selected?: string[] | null;
  // Case ancre = montant cliqué dans le tableau ; reste surligné tant que le panneau
  // est ouvert, en plus de la case active.
  anchor?: string | null;
  // Compte affiché : nécessaire au bloc de décision d'un dépassement (Task 6).
  accountId: string;
  // Décisions déjà prises sur des dépassements (groupId, mois), chargées en page.
  decisions?: OverspendDecisionInfo[];
  // Dépassements de mois terminés sans décision (pastilles) et budgets courants par
  // groupe (pré-remplissage de la décision) : Task 7.
  pendingClosed?: PendingOverspend[];
  currentBudgets?: Record<number, number>;
}) {
  // Décision déjà prise, indexée par « groupId::mois » : sert à attacher
  // overspendAction sur les Balances rouges (cf. AmountCells / SectionTotalsCells).
  const decisionByKey = useMemo(
    () => new Map((decisions ?? []).map((d) => [`${d.groupId}::${d.month}`, d.decision])),
    [decisions],
  );
  // Premier dépassement en attente par groupe (le plus ancien), pour la pastille.
  const pendingByGroup = useMemo(() => {
    const m = new Map<number, PendingOverspend>();
    for (const p of pendingClosed ?? []) if (!m.has(p.groupId)) m.set(p.groupId, p);
    return m;
  }, [pendingClosed]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Case active (B) choisie dans le panneau : sert au défilement et à la révélation.
  // S'il y en a plusieurs (somme), on défile vers la première.
  const activeCell = selected?.[0] ?? null;
  // Cases à surligner dans le tableau : l'ancre (A, le montant cliqué dans le tableau,
  // qui reste sélectionné tant que le panneau est ouvert) ET les cases actives (B).
  const selCellKey = useMemo(
    () => new Set([anchor, ...(selected ?? [])].filter((k): k is string => k != null)),
    [anchor, selected],
  );
  // Ligne porteuse de la case active : préfixe de la clé « <ligne>::col::mois »
  // (ex. txn:<id>, subrow:<id>). Sert à retrouver les dépliages qui la révèlent.
  const selRowKey = activeCell ? activeCell.slice(0, activeCell.indexOf("::")) : null;
  // Conteneur du tableau (display:contents) : sert à repérer, par data-cellkey, la
  // case sélectionnée pour la faire défiler dans la vue — sans être lui-même un
  // conteneur de mise en page.
  const gridRef = useRef<HTMLDivElement>(null);

  // Pour chaque ligne masquable (transaction, sous-ligne d'un récurrent) : clés de
  // dépliage de ses ancêtres (groupe, et éventuelle ligne), afin de la révéler dans
  // le tableau quand on la sélectionne depuis le side panel.
  const revealOpenKeys = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const sec of sections) {
      if (sec.kind === "uncategorized") {
        const k = sec.uncatDirection === "in" ? "s:uncat-in" : "s:uncat";
        for (const t of sec.txns ?? []) m.set(txnRow(t.id), [k]);
      } else {
        for (const r of sec.rows) {
          for (const t of r.txns) m.set(txnRow(t.id), [`g:${r.id}`]);
          for (const sub of r.subRows) {
            m.set(subRow(sub.id), [`g:${r.id}`]);
            for (const t of sub.txns) m.set(txnRow(t.id), [`g:${r.id}`, `l:${sub.id}`]);
          }
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
      if (sec.kind === "uncategorized") stops.push(sectionRowKey(sec));
      else for (const r of sec.rows) stops.push(groupRow(r.id));
    }
    const m = new Map<string, string>();
    for (let k = 1; k < stops.length; k++) m.set(stops[k], stops[k - 1]);
    return m;
  }, [sections]);

  // Index du mois courant (même repli que computePlannedSoldes : borne la plus
  // proche si hors plage).
  const ciSafe = useMemo(() => {
    const idx = months.indexOf(currentMonth);
    if (idx !== -1) return idx;
    return months.length > 0 && currentMonth < months[0] ? 0 : months.length - 1;
  }, [months, currentMonth]);

  // Pour chaque ligne porteuse de plan (dans l'ordre d'accumulation de
  // computePlannedSoldes) et chaque mois, la liste des dépassements de budget par
  // groupe cumulés jusqu'à elle incluse. Sert à décomposer le « Dépassement
  // cumulé » du solde si dépassement. Mois passés / courant : dépassements réels du
  // mois affiché (le plan s'y ancre) ; mois futurs : dépassements retenus (non
  // tranchés) si fournis, sinon repli sur les dépassements réels du mois courant.
  const depassCumulByRow = useMemo(() => {
    const map = new Map<number, { id: number; name: string; amount: number }[][]>();
    if (ciSafe < 0) return map;
    const realOs = (r: HistoryRow, m: number) => {
      const cell = r.cells[m];
      return r.direction === "out" && cell ? Math.max(0, cell.depense - cell.budgeted) : 0;
    };
    for (let i = 0; i < months.length; i++) {
      const isFuture = months[i] > currentMonth;
      const osMonth = isFuture ? ciSafe : i;
      const acc: { id: number; name: string; amount: number }[] = [];
      for (const sec of sections) {
        if (sec.kind === "uncategorized") continue;
        for (const r of sec.rows) {
          const os = isFuture && retained ? retained.byGroup[r.id] ?? 0 : realOs(r, osMonth);
          if (os > 0.005) acc.push({ id: r.id, name: r.name, amount: os });
          let lists = map.get(r.id);
          if (!lists) map.set(r.id, (lists = []));
          lists[i] = acc.slice();
        }
      }
    }
    return map;
  }, [sections, ciSafe, months, currentMonth, retained]);

  // Estimé de fin du mois courant, aligné sur le tableau : Solde actuel + les
  // rémunérations restant à recevoir − les Balances vertes non nulles (le budget
  // restant, qu'on suppose dépensé d'ici la fin du mois).
  const tableEstimate = useMemo(
    () => computeTableEstimate(sections, months, currentMonth, forecast.balance),
    [sections, months, currentMonth, forecast.balance],
  );
  const estimateValue = tableEstimate?.value ?? forecast.currentEstimate;

  // Dépliage effectif = dépliage utilisateur, plus les ancêtres de la ligne
  // sélectionnée (transaction ou sous-ligne, pour la révéler sans muter l'état de
  // dépliage manuel). Dérivé plutôt que posé dans un effet : pas de setState en cascade.
  const effectiveOpen = useMemo(() => {
    if (!selRowKey) return open;
    const keys = revealOpenKeys.get(selRowKey);
    if (!keys || keys.every((k) => open.has(k))) return open;
    const next = new Set(open);
    for (const k of keys) next.add(k);
    return next;
  }, [open, selRowKey, revealOpenKeys]);
  const isOpen = (k: string) => effectiveOpen.has(k);

  // Nombre total de colonnes du tableau (Catégorie + colonnes de chaque mois),
  // pour l'attribut colSpan des lignes d'espacement entre sections.
  const totalCols = 1 + months.reduce((n, m) => n + monthColumns(monthType(m, currentMonth)).length, 0);

  // Faire défiler la case sélectionnée dans la vue (après dépliage éventuel : la
  // dépendance sur effectiveOpen relance l'effet une fois la ligne montée). On
  // défile explicitement le conteneur horizontal (CenterScroll) et le conteneur
  // vertical, plutôt que scrollIntoView, pour tenir compte de la première colonne
  // collante (sinon la case reste cachée derrière) et défiler le bon conteneur.
  useEffect(() => {
    if (!activeCell) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cellkey="${activeCell}"]`);
    if (!el) return;
    const pad = 12;

    // Horizontal : révéler la case à droite de la colonne collante de gauche.
    const hx = scrollableAncestor(el, "x");
    if (hx) {
      const cRect = hx.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const sticky = hx.querySelector<HTMLElement>("thead th.sticky, tbody td.sticky");
      const stickyW = sticky ? sticky.getBoundingClientRect().width : 0;
      const visLeft = cRect.left + stickyW;
      // behavior "auto" (instantané) : le défilement "smooth" est ignoré sur ce
      // conteneur (colonne collante), la case n'était alors jamais révélée.
      if (eRect.left < visLeft) hx.scrollBy({ left: eRect.left - visLeft - pad, behavior: "auto" });
      else if (eRect.right > cRect.right) hx.scrollBy({ left: eRect.right - cRect.right + pad, behavior: "auto" });
    }

    // Vertical : révéler la ligne dans le conteneur qui défile en hauteur.
    const vy = scrollableAncestor(el, "y");
    if (vy) {
      const cRect = vy.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      if (eRect.top < cRect.top) vy.scrollBy({ top: eRect.top - cRect.top - pad, behavior: "auto" });
      else if (eRect.bottom > cRect.bottom) vy.scrollBy({ top: eRect.bottom - cRect.bottom + pad, behavior: "auto" });
    }
  }, [activeCell, effectiveOpen]);

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
            {pendingByGroup.has(r.id) && (
              <button
                type="button"
                aria-label="Dépassement à traiter"
                onClick={(e) => {
                  e.stopPropagation();
                  const p = pendingByGroup.get(r.id)!;
                  const idx = months.indexOf(p.month);
                  onSelect(overspendDecisionDetail(p, accountId, idx === -1 ? null : idx, null, currentBudgets?.[r.id] ?? null));
                }}
                className="ml-1 inline-block size-2 shrink-0 rounded-full bg-amber-500"
              />
            )}
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
            depassCumulRows={depassCumulByRow.get(r.id)}
            accountId={accountId}
            decisionByKey={decisionByKey}
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

  // Ligne dédiée affichant le Reste/Manque final d'une section de dépense
  // (Récurrents / Enveloppes) en bas du tableau, dans la colonne Reste/Manque.
  // Le montant est retiré de la ligne « Total ... » et reporté ici.
  const renderSectionResteRow = (kind: "recurring" | "envelope", label: string) => {
    const sec = sections.find((s) => s.kind === kind);
    if (!sec) return null;
    const rowKey = `reste:${kind}`;
    return (
      <TableRow className="text-sm">
        <TableCell className="bg-background sticky left-0 z-10 p-0">
          <FirstColBox><span className="text-muted-foreground">{label}</span></FirstColBox>
        </TableCell>
        {months.map((m, i) => {
          const type = monthType(m, currentMonth);
          const cols = monthColumns(type);
          const c = sec.totals[i];
          const subtitle = `${label} · ${monthLabel(m)}`;
          // Décomposition Budget − Dépensé (les sections de dépense vérifient l'invariant).
          const depNodes = sec.rows.map((r) => groupNode(r, i, m, "depense")).filter((n) => n.amount !== 0);
          const detail: CellDetail = makeDetail(
            "Reste",
            [
              { label: "Budget", amount: c.budgeted, ref: cellKey(sectionRow(kind), "budget", i) },
              { label: "Dépensé", amount: -c.depense, ref: cellKey(sectionRow(kind), "depense", i), children: depNodes.map(negateNode) },
            ],
            { subtitle, result: c.balance },
          );
          const resteCell = (b: boolean) => (
            <CellAmount key="reste" className={cn(b && "border-l", "text-right tabular-nums", resteColor(c.balance))} detail={detail} onSelect={onSelect} cellKey={cellKey(rowKey, "reste", i)} selCellKey={selCellKey}>
              {fmt(c.balance)}
            </CellAmount>
          );
          const slots = blankSlots();
          slots.reste = resteCell;
          return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
        })}
      </TableRow>
    );
  };

  // Ligne « Non catégorisés » d'une des deux sections (reçus / dépenses) : total
  // dépliable sur ses transactions. Les reçus s'affichent sous les rémunérations,
  // les dépenses après les enveloppes.
  const renderUncatRows = (sec: HistorySection) => {
    const dir = sec.uncatDirection ?? "out";
    const uKey = dir === "in" ? "s:uncat-in" : "s:uncat";
    const uOpen = isOpen(uKey);
    const hasTxns = (sec.txns?.length ?? 0) > 0;
    const rowKey = sectionRowKey(sec);
    // Valeurs courues des chaînes du plan à cette étape (calculées par
    // computePlannedSoldes dans l'ordre de lecture, débordement net déjà retiré
    // pour la ligne dépenses).
    const planPrevu = planned.uncatPrevuRunning[dir];
    const planDepass = planned.uncatDepassRunning[dir];
    return (
      <>
        <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
          <NameCell indent={0} bg={MUTED40} expandable={hasTxns} expanded={uOpen} onToggle={hasTxns ? () => toggle(uKey) : undefined}>
            <span className="min-w-0 truncate">Non catégorisés</span>
            {dir === "out" && pendingByGroup.has(0) && (
              <button
                type="button"
                aria-label="Dépassement à traiter"
                onClick={(e) => {
                  e.stopPropagation();
                  const p = pendingByGroup.get(0)!;
                  const idx = months.indexOf(p.month);
                  onSelect(overspendDecisionDetail(p, accountId, idx === -1 ? null : idx, null, null));
                }}
                className="ml-1 inline-block size-2 shrink-0 rounded-full bg-amber-500"
              />
            )}
          </NameCell>
          <SectionTotalsCells
            sec={sec}
            months={months}
            currentMonth={currentMonth}
            onSelect={onSelect}
            solde={solde.uncategorizedRunning?.[dir] ?? undefined}
            planPrevu={planPrevu}
            planDepass={planDepass}
            uncatInSec={dir === "out" ? sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in") : undefined}
            selCellKey={selCellKey}
            prevRowKey={prevSoldeRowKey.get(rowKey)}
            retained={retained}
            accountId={accountId}
            decisionByKey={decisionByKey}
          />
        </TableRow>
        {uOpen && sec.txns?.map((t) => (
          <TxnRow key={t.id} txn={t} months={months} currentMonth={currentMonth} groups={groups} indent={1} onSelect={onSelect} selCellKey={selCellKey} />
        ))}
      </>
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
      {/* Teinte de fond des colonnes de solde (posée sous le fond des lignes). */}
      <colgroup>
        <col />
        {months.map((m) =>
          monthColumns(monthType(m, currentMonth)).map((col) => (
            <col key={`${m}-${col}`} className={cn(SOLDE_COLS_SET.has(col) && SOLDE_TINT, col === "reste" && BALANCE_TINT)} />
          )),
        )}
      </colgroup>
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
            const firstSolde = cols.find((c) => SOLDE_COLS_SET.has(c));
            return (
              <Fragment key={m}>
                {cols.map((col, idx) => (
                  <TableHead key={col} className={cn(idx === 0 && "border-l", col === firstSolde && SOLDE_SEP, "text-right")}>
                    {/* Cliquer l'en-tête ouvre l'explication de la colonne dans le panneau. */}
                    <button
                      type="button"
                      onClick={() => onSelect(makeInfo(labelFor(col, type), COL_INFO[col]))}
                      className="cursor-pointer decoration-dotted underline-offset-2 hover:underline"
                    >
                      {labelFor(col, type)}
                    </button>
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
                : months[i - 1] === currentMonth && months[i] > currentMonth
                  ? // Premier mois futur : il s'ouvre sur l'estimé de fin du mois courant.
                    makeDetail(
                      "Argent de départ",
                      [{ label: "Estimé fin du mois précédent", amount: solde.openings[i], ref: cellKey("estime", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: solde.openings[i] },
                    )
                  : makeDetail(
                      "Argent de départ",
                      [{ label: "Solde de fin du mois précédent", amount: solde.closings[i - 1], ref: cellKey("grand", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: solde.openings[i] },
                    );
            const type = monthType(months[i], currentMonth);
            const cols = monthColumns(type);
            // L'ouverture est commune aux trois chaînes au mois courant. En
            // projection, l'ouverture d'une chaîne = clôture (prévue / si dépassement)
            // du mois précédent ; repli sur l'argent de départ réel au 1er mois.
            // Mois passés et courant : le plan s'ancre sur l'ouverture réelle du mois.
            // Premier mois futur : les deux chaînes repartent de l'estimé de fin du
            // mois courant. Mois futurs suivants : elles enchaînent sur la clôture
            // (prévue / si dépassement) du mois précédent.
            const firstFuture = months[i] > currentMonth && i > 0 && months[i - 1] === currentMonth;
            const prevuOpen =
              months[i] <= currentMonth ? v
              : firstFuture ? estimateValue
              : i > 0 && planned.prevuClosings[i - 1] != null ? planned.prevuClosings[i - 1] : v;
            const depassOpen =
              months[i] <= currentMonth ? v
              : firstFuture ? estimateValue
              : i > 0 && planned.depassClosings[i - 1] != null ? planned.depassClosings[i - 1] : v;
            const openingCell = (b: boolean) => (
              <CellAmount key="soldeReel" className={cn(b && "border-l", "text-right tabular-nums", v < -0.005 && "text-red-600")} detail={detail} onSelect={onSelect} cellKey={cellKey(openingRow, "solde", i)} selCellKey={selCellKey}>
                {fmt(v)}
              </CellAmount>
            );
            // Détail des ouvertures de plan : sur un mois passé ou courant, l'ouverture
            // prévue / si dépassement vaut l'argent de départ réel (même détail). En
            // projection, elle vaut la clôture (prévue / si dépassement) du mois passé.
            const prevuOpenDetail: CellDetail =
              months[i] <= currentMonth
                ? detail
                : firstFuture
                  ? makeDetail(
                      "Argent de départ",
                      [{ label: "Estimé fin du mois précédent", amount: prevuOpen ?? 0, ref: cellKey("estime", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: prevuOpen ?? 0 },
                    )
                  : makeDetail(
                      "Argent de départ",
                      [{ label: "Solde prévu de fin du mois précédent", amount: prevuOpen ?? 0, ref: i > 0 ? cellKey("grand", "soldePrevu", i - 1) : undefined }],
                      { subtitle: monthLabel(months[i]), result: prevuOpen ?? 0 },
                    );
            const depassOpenDetail: CellDetail =
              months[i] <= currentMonth
                ? detail
                : firstFuture
                  ? makeDetail(
                      "Argent de départ",
                      [{ label: "Estimé fin du mois précédent", amount: depassOpen ?? 0, ref: cellKey("estime", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: depassOpen ?? 0 },
                    )
                  : makeDetail(
                      "Argent de départ",
                      [{ label: "Solde de fin du mois précédent (si dépassement)", amount: depassOpen ?? 0, ref: i > 0 ? cellKey("grand", "soldeDepass", i - 1) : undefined }],
                      { subtitle: monthLabel(months[i]), result: depassOpen ?? 0 },
                    );
            const slots = blankSlots();
            slots.soldeReel = openingCell;
            slots.soldePrevu = (b) => plannedSoldeCell("soldePrevu", prevuOpen, b, prevuOpenDetail, onSelect, cellKey(openingRow, "soldePrevu", i), selCellKey);
            slots.soldeDepass = (b) => plannedSoldeCell("soldeDepass", depassOpen, b, depassOpenDetail, onSelect, cellKey(openingRow, "soldeDepass", i), selCellKey);
            return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
          })}
        </TableRow>
        {sections.map((sec, si) => {
          // Un petit espace sépare chaque section de la précédente.
          const spacer = si > 0 ? <SpacerRow cols={totalCols} /> : null;
          if (sec.kind === "income") {
            // Rémunérations : lignes au niveau des sections, tout en haut, sans en-tête,
            // puis les reçus non catégorisés, puis une ligne « Total rémunérations »
            // (principale + supplémentaire).
            const uncatIn = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in");
            return (
              <Fragment key={sec.kind}>
                {spacer}
                {sec.rows.map((r) => renderGroup(r, true))}
                {uncatIn && renderUncatRows(uncatIn)}
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
            // Les reçus non catégorisés sont rendus dans la section Rémunérations
            // (ci-dessus) quand elle existe ; sinon ils s'affichent ici, à leur place.
            if (sec.uncatDirection === "in" && sections.some((s) => s.kind === "income")) return null;
            return (
              <Fragment key={`uncat-${sec.uncatDirection ?? "out"}`}>
                {spacer}
                {renderUncatRows(sec)}
              </Fragment>
            );
          }
          // Récurrents / Enveloppes : les lignes d'abord, puis une ligne de total en
          // bas (« Total Récurrents » / « Total Enveloppes »), comme les rémunérations.
          return (
            <Fragment key={sec.kind}>
              {spacer}
              {sec.rows.map((r) => renderGroup(r))}
              <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                <TableCell className={cn("sticky left-0 z-10 p-0", MUTED40)}>
                  <FirstColBox>{sec.kind === "envelope" ? "Total Enveloppes" : "Total Récurrents"}</FirstColBox>
                </TableCell>
                <SectionTotalsCells sec={sec} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} />
              </TableRow>
              {renderSectionResteRow(sec.kind, sec.kind === "envelope" ? "Balance enveloppes" : "Balance récurrents")}
            </Fragment>
          );
        })}
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Solde actuel</FirstColBox>
          </TableCell>
          <GrandTotalsCells sections={sections} grand={grand} solde={solde} planned={planned} overspend={overspend} months={months} currentMonth={currentMonth} currentEstimate={estimateValue} onSelect={onSelect} selCellKey={selCellKey} retained={retained} />
        </TableRow>
        {/* Estimé fin de mois : mois courant = Solde actuel + rémunérations restant
            à recevoir − Balances vertes (le budget restant, supposé dépensé d'ici la
            fin du mois) ; autres mois = leur solde de clôture (même détail que la
            ligne « Solde actuel » pour ce mois — cf. soldeActuelDetail). */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Estimé fin de mois</span></FirstColBox>
          </TableCell>
          {months.map((m, i) => {
            const isCurrent = m === currentMonth;
            const v = isCurrent ? estimateValue : solde.closings[i];
            const detail: CellDetail = isCurrent
              ? makeDetail(
                  "Estimé fin de mois",
                  [
                    { label: "Solde actuel", amount: forecast.balance, ref: cellKey("grand", "solde", i) },
                    ...(tableEstimate?.incomeSteps ?? []).map((s): DetailNode => ({
                      label: `${s.name} — reste à recevoir`,
                      amount: s.amount,
                      ref: cellKey(groupRow(s.id), "revenus", i),
                    })),
                    ...(tableEstimate?.spendSteps ?? []).map((s): DetailNode => ({
                      label: `${s.name} — reste à dépenser`,
                      amount: -s.amount,
                      ref: cellKey(groupRow(s.id), "reste", i),
                    })),
                  ],
                  { subtitle: monthLabel(m), result: v },
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
            slots.soldeReel = estCell;
            return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
          })}
        </TableRow>
        {/* Dépassement final du mois : somme des montants rouges de la colonne
            Balance (groupes qui débordent + Non catégorisés), hors lignes
            « Balance récurrents / enveloppes » qui agrègent déjà ces montants. */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Dépassement hors budget</span></FirstColBox>
          </TableCell>
          {months.map((m, i) => {
            // Part rouge de la Balance des non catégorisés (ligne dépenses) = dépensé
            // au-delà des reçus non catégorisés (la ligne du haut).
            const uncatDep = uncatOverspend(sections, i);
            const val = overspend[i] + uncatDep;
            const nodes: DetailNode[] = [
              ...sections
                .flatMap((s) => s.rows)
                .filter((r) => r.direction === "out" && r.cells[i].balance < -0.005)
                .map((r): DetailNode => ({ label: r.name, amount: -r.cells[i].balance, ref: cellKey(groupRow(r.id), "reste", i) })),
              ...(uncatDep > 0.005
                ? [{ label: "Non catégorisés", amount: uncatDep, ref: cellKey(sectionRow("uncategorized"), "reste", i) }]
                : []),
            ];
            const detail: CellDetail | null =
              val > 0.005 ? makeDetail("Dépassement hors budget", nodes, { subtitle: monthLabel(m), result: val }) : null;
            const type = monthType(m, currentMonth);
            const cols = monthColumns(type);
            const depCell = (b: boolean) => (
              <CellAmount key="overspend" className={cn(b && "border-l", "text-right tabular-nums", val > 0.005 && "text-red-600")} detail={detail} onSelect={onSelect} cellKey={cellKey("overspend", "reste", i)} selCellKey={selCellKey}>
                {val > 0.005 ? fmt(val) : "—"}
              </CellAmount>
            );
            const slots = blankSlots();
            slots.reste = depCell;
            return <Fragment key={i}>{renderCols(cols, slots)}</Fragment>;
          })}
        </TableRow>
      </TableBody>
    </Table>
    </div>
  );
}
