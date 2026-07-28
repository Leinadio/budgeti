// Construction des calculs affichés dans le side panel de l'Historique : chaque
// case chiffrée du tableau ouvre un arbre de nœuds signés qui se déplie jusqu'aux
// transactions, et dont chaque ligne renvoie (ref) vers la case du tableau qui
// porte son montant. Ces fonctions sont pures : elles ne dépendent que des données
// déjà calculées par computeHistory / computeSolde, jamais du rendu.
import { monthLabel } from "./transactions-view";
import type { HistorySection, HistoryRow, HistoryTxn, MonthCell, SoldeColumn, PendingOverspend } from "./history";
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
} from "./history-explain";

// Nature du montant porté par un nœud : les trois colonnes chiffrées du tableau,
// plus le « net » (recu − depense) que lisent les chaînes de solde.
export type NodeKind = "depense" | "recu" | "budget" | "net";

// Colonne du tableau qui affiche un montant, selon la nature du nœud. Pour un
// « net » (recu − depense) : la colonne où il apparaît réellement (Dép. pour une
// ligne de dépense pure, Reçu pour une entrée pure), Solde en dernier recours.
export function netCol(c: MonthCell): Col {
  if (Math.abs(c.recu) < 0.005) return "depense";
  if (Math.abs(c.depense) < 0.005) return "recu";
  return "solde";
}

export function colOf(kind: NodeKind, c: MonthCell): Col {
  return kind === "depense" ? "depense" : kind === "recu" ? "recu" : kind === "budget" ? "budget" : netCol(c);
}

// Transactions d'un groupe (et de ses lignes) pour un mois → nœuds feuilles signés.
// sign = +1 pour un contexte « addition » (ex. colonne Dépensé/Reçu prise positivement),
//        -1 pour un contexte « soustraction » (ex. sous-nœud Dépensé d'un Reste).
export function txnChildren(r: HistoryRow, month: string, sign: 1 | -1, i: number): DetailNode[] | undefined {
  const all = [...r.txns, ...r.subRows.flatMap((s) => s.txns)].filter((t) => t.month === month);
  if (all.length === 0) return undefined;
  return all.map((t) =>
    txnNode(t.date, t.label, sign * Math.abs(t.amount), cellKey(txnRow(t.id), t.amount < 0 ? "depense" : "recu", i)),
  );
}

// Postes (lignes) d'un récurrent pour un mois → nœuds « Budget ». undefined si le
// groupe n'a pas de lignes (enveloppe) ou si tous les postes sont à 0 pour ce mois.
export function budgetNodes(r: HistoryRow, i: number): DetailNode[] | undefined {
  if (r.subRows.length === 0) return undefined;
  const nodes = r.subRows
    .map((s): DetailNode => ({ label: s.name, amount: s.cells[i].budgeted, ref: cellKey(subRow(s.id), "budget", i) }))
    .filter((n) => n.amount !== 0);
  return nodes.length > 0 ? nodes : undefined;
}

// Un groupe comme nœud d'un calcul de section/total : montant = sa contribution
// (signée) pour la colonne demandée, enfants = ses transactions du mois (sauf pour
// « budget », qui n'a pas de transactions).
export function groupNode(r: HistoryRow, i: number, month: string, kind: NodeKind): DetailNode {
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
export function negateNode(n: DetailNode): DetailNode {
  return { ...n, amount: -n.amount, children: n.children?.map(negateNode) };
}

// Clé de ligne d'une section pour les data-cellkey. Les deux sections « non
// catégorisés » (reçus / dépenses) ont chacune la leur.
export function sectionRowKey(sec: HistorySection): string {
  return sec.kind === "uncategorized" && sec.uncatDirection === "in" ? "section:uncat-in" : sectionRow(sec.kind);
}

export function labelOfSection(kind: HistorySection["kind"]): string {
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
export function uncatTxnNodes(sec: HistorySection, month: string, i: number): DetailNode[] | undefined {
  const all = (sec.txns ?? []).filter((t) => t.month === month);
  if (all.length === 0) return undefined;
  return all.map((t) => txnNode(t.date, t.label, t.amount, cellKey(txnRow(t.id), t.amount < 0 ? "depense" : "recu", i)));
}

// Variante de txnChildren pour les non catégorisés (pas de HistoryRow : transactions
// à plat sur la section) : ne garde que les transactions du sens demandé (isOut),
// en valeur absolue — même convention que txnChildren(r, month, 1) pour Dépensé/Reçu.
export function sectionTxnChildren(txns: HistoryTxn[] | undefined, month: string, isOut: boolean, i: number): DetailNode[] | undefined {
  const filtered = (txns ?? []).filter((t) => t.month === month && (isOut ? t.amount < 0 : t.amount > 0));
  if (filtered.length === 0) return undefined;
  return filtered.map((t) => txnNode(t.date, t.label, Math.abs(t.amount), cellKey(txnRow(t.id), t.amount < 0 ? "depense" : "recu", i)));
}

// Une section comme nœud d'un calcul global (Solde actuel / Estimé / Reçu-Dépensé-
// Budget du grand total) : montant = sa contribution pour la colonne demandée,
// enfants = ses groupes (ou, pour les non catégorisés qui n'ont pas de groupes,
// directement ses transactions).
export function sectionNode(sec: HistorySection, i: number, month: string, kind: NodeKind): DetailNode {
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
export function soldeActuelDetail(
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

// Détail minimal ouvert par le bandeau, une pastille ou une Balance rouge : le
// montant du dépassement et le bloc de décision. cellRef surligne la Balance du bon
// mois quand il est affiché (monthIdx), sinon le panneau s'ouvre sans surbrillance.
// currentBudget : budget/provision du groupe en vigueur au mois courant, pour
// pré-remplir le champ « Permanent » ; null si inconnu.
export function overspendDecisionDetail(
  item: PendingOverspend,
  accountId: string,
  monthIdx: number | null,
  decision: "exceptional" | "permanent" | null,
  currentBudget: number | null = null,
): CellDetail {
  return {
    title: "Dépassement",
    subtitle: `${item.name} · ${monthLabel(item.month)}`,
    nodes: [],
    result: item.amount,
    cellRef:
      monthIdx != null
        ? cellKey(item.groupId === 0 ? sectionRow("uncategorized") : groupRow(item.groupId), "reste", monthIdx)
        : undefined,
    overspendAction: {
      accountId,
      groupId: item.groupId,
      groupName: item.name,
      month: item.month,
      amount: item.amount,
      decision,
      currentBudget,
    },
  };
}

// Identité d'un détail : le side panel s'en sert comme clé de montage, pour que
// l'état de dépliage reparte de zéro dès qu'on ouvre autre chose. Un calcul est
// identifié par la CASE qui l'a ouvert : deux cases différentes qui affichent le
// même montant restent deux détails distincts.
export function detailKey(d: CellDetail): string {
  if (d.groupManage) return `manage:${d.groupManage.groupId}:${d.groupManage.month}`;
  if (d.uncatProvision) return `provision:${d.uncatProvision.month}`;
  if (d.description) return `info:${d.title}`;
  return d.cellRef ?? `${d.title}·${d.subtitle ?? ""}·${d.result}`;
}
