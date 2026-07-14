import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";
import type { Group, Txn } from "./forecast";

// depense et recu séparés selon le sens du groupe (une seule des deux est non nulle
// pour une ligne ; les sous-totaux additionnent les deux). balance = budgeted - réalisé.
export type MonthCell = { budgeted: number; depense: number; recu: number; balance: number };
// Une transaction détaillée, rattachée à un groupe ou à un sous-groupe (ligne).
// group_id / line_id portés pour alimenter le menu de (ré)assignation.
export type HistoryTxn = {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
  amount: number; // signé (négatif = sortie)
  month: string; // YYYY-MM
  groupId: number | null;
  lineId: number | null;
};
// Un sous-groupe = une ligne d'un récurrent (Spotify, Direct Assurance…).
export type HistorySubRow = {
  id: number;
  name: string;
  cells: MonthCell[]; // alignées sur les mois
  txns: HistoryTxn[]; // transactions rattachées à cette ligne
};
export type HistoryRow = {
  id: number;
  name: string;
  kind: "envelope" | "recurring";
  direction: "in" | "out";
  cells: MonthCell[]; // alignées sur la liste des mois passée à computeHistory
  subRows: HistorySubRow[]; // lignes des récurrents (vide pour une enveloppe)
  txns: HistoryTxn[]; // transactions directement sous le groupe (enveloppe, ou récurrent sans ligne)
};
export type HistorySection = {
  kind: "envelope" | "recurring" | "uncategorized";
  rows: HistoryRow[];
  totals: MonthCell[];
  txns?: HistoryTxn[]; // uniquement pour « uncategorized » : liste plate
};

// Mois distincts « YYYY-MM » présents dans les transactions, triés croissant.
export function monthsWithData(txns: Txn[]): string[] {
  const set = new Set<string>();
  for (const t of txns) set.add(t.date.slice(0, 7));
  return [...set].sort();
}

// Décale une clé « YYYY-MM » de n mois (n peut être négatif).
export function addMonthsKey(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + n);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthKey(m: string): string {
  return addMonthsKey(m, 1);
}

// Liste des clés « YYYY-MM » de from à to inclus (ordre croissant, bornes triées).
export function monthRange(from: string, to: string): string[] {
  const lo = from <= to ? from : to;
  const hi = from <= to ? to : from;
  const out: string[] = [];
  for (let cur = lo; cur <= hi; cur = addMonthsKey(cur, 1)) out.push(cur);
  return out;
}

// Nombre de mois de a vers b (positif si b est après a).
export function monthsDiff(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return yb * 12 + (mb - 1) - (ya * 12 + (ma - 1));
}

// Valide un « YYYY-MM » (ex. venant de l'URL).
export function isMonthKey(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}$/.test(v) && Number(v.slice(5, 7)) >= 1 && Number(v.slice(5, 7)) <= 12;
}

// Borne une clé de mois dans [min, max].
export function clampMonth(m: string, min: string, max: string): string {
  if (m < min) return min;
  if (m > max) return max;
  return m;
}

function budgetOf(g: Group): number {
  return g.kind === "envelope" ? g.monthlyAmount ?? 0 : g.lines.reduce((s, l) => s + l.amount, 0);
}

function toOwnable(g: Group): OwnableGroup {
  return {
    id: g.id,
    accountId: g.accountId,
    direction: g.direction,
    kind: g.kind,
    keywords: g.kind === "envelope" ? g.keywords : g.lines.map((l) => l.keyword),
  };
}

function emptyCell(): MonthCell {
  return { budgeted: 0, depense: 0, recu: 0, balance: 0 };
}

// Les mois > currentMonth sont des projections, alignées sur le Prévisionnel
// (« dépassements maintenus ») : Dépensé projeté = Budgété + dépassement du mois
// courant. Un groupe dans les clous reste à son budget ; un groupe qui dépasse
// projette sa dépense réelle, avec un Solde négatif.
export function computeHistory(
  groups: Group[],
  txns: Txn[],
  months: string[],
  currentMonth: string,
): HistorySection[] {
  const ownable = groups.map(toOwnable);
  const owned = txns.map((t) => {
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    const ownerId = res.status === "manual" ? res.groupId : null;
    return { t, ownerId, month: t.date.slice(0, 7) };
  });

  const spent = (gid: number, m: string) =>
    owned.filter((o) => o.ownerId === gid && o.month === m).reduce((s, o) => s + Math.abs(o.t.amount), 0);

  // Rattache une transaction d'un récurrent à une de ses lignes uniquement via
  // le line_id manuel ; sinon elle reste directement sous le groupe.
  const lineOf = (g: Group, t: Txn): number | null =>
    t.lineId != null && g.lines.some((l) => l.id === t.lineId) ? t.lineId : null;

  const toHistoryTxn = (t: Txn): HistoryTxn => ({
    id: t.id, date: t.date, label: t.label, amount: t.amount, month: t.date.slice(0, 7),
    groupId: t.groupId, lineId: t.lineId ?? null,
  });

  // On ne liste que les transactions des mois affichés.
  const inRange = (t: Txn) => months.includes(t.date.slice(0, 7));

  const cellsFor = (budgeted: number, isOut: boolean, overspend: number, realizedOf: (m: string) => number): MonthCell[] =>
    months.map((m) => {
      const realized = m > currentMonth ? budgeted + overspend : realizedOf(m);
      return {
        budgeted,
        depense: isOut ? realized : 0,
        recu: isOut ? 0 : realized,
        balance: budgeted - realized,
      };
    });

  const rowFor = (g: Group): HistoryRow => {
    const budgeted = budgetOf(g);
    const isOut = g.direction === "out";
    // Transactions du groupe (possédées, non exclues), récentes d'abord.
    const mine = owned
      .filter((o) => o.ownerId === g.id)
      .map((o) => o.t)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // Dépassement du mois courant, reporté sur les projections (comme le Prévisionnel).
    const overspend = isOut ? Math.max(0, spent(g.id, currentMonth) - budgeted) : 0;
    const cells = cellsFor(budgeted, isOut, overspend, (m) => spent(g.id, m));

    // Sous-groupes : une ligne par poste du récurrent ; les projections gardent
    // juste le budget de la ligne (pas de dépassement au niveau ligne).
    const subRows: HistorySubRow[] = g.lines.map((l) => {
      const lineTxns = mine.filter((t) => lineOf(g, t) === l.id);
      const realizedOf = (m: string) =>
        lineTxns.filter((t) => t.date.slice(0, 7) === m).reduce((s, t) => s + Math.abs(t.amount), 0);
      return {
        id: l.id,
        name: l.name,
        cells: cellsFor(l.amount, isOut, 0, realizedOf),
        txns: lineTxns.filter(inRange).map(toHistoryTxn),
      };
    });

    // Transactions directement sous le groupe : enveloppe (pas de lignes) ou
    // récurrent dont la transaction ne matche aucune ligne.
    const groupTxns = mine.filter((t) => lineOf(g, t) === null && inRange(t)).map(toHistoryTxn);

    return { id: g.id, name: g.name, kind: g.kind, direction: g.direction, cells, subRows, txns: groupTxns };
  };

  const section = (kind: "envelope" | "recurring"): HistorySection | null => {
    const rows = groups.filter((g) => g.kind === kind).map(rowFor);
    if (rows.length === 0) return null;
    const totals = months.map((_, i) =>
      rows.reduce((acc, r) => {
        const c = r.cells[i];
        return {
          budgeted: acc.budgeted + c.budgeted,
          depense: acc.depense + c.depense,
          recu: acc.recu + c.recu,
          balance: acc.balance + c.balance,
        };
      }, emptyCell()),
    );
    return { kind, rows, totals };
  };

  // Transactions sans groupe : listées par mois, avec un total Dépensé/Reçu.
  const uncategorized = (): HistorySection | null => {
    const mine = owned
      .filter((o) => o.ownerId === null && inRange(o.t))
      .map((o) => o.t)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (mine.length === 0) return null;
    const totals = months.map((m) => {
      const monthTxns = mine.filter((t) => t.date.slice(0, 7) === m);
      const depense = monthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const recu = monthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      return { budgeted: 0, depense, recu, balance: recu - depense };
    });
    return { kind: "uncategorized", rows: [], totals, txns: mine.map(toHistoryTxn) };
  };

  return [section("envelope"), section("recurring"), uncategorized()].filter(
    (s): s is HistorySection => s !== null,
  );
}

// Dépassement total par mois : somme des dépassements des groupes de sortie
// (part dépensée au-delà du budget). Les entrées ne comptent pas.
export function monthlyOverspend(sections: HistorySection[], monthCount: number): number[] {
  const rows = sections.flatMap((s) => s.rows);
  return Array.from({ length: monthCount }, (_, i) =>
    rows.reduce((acc, r) => (r.direction === "out" ? acc + Math.max(0, -r.cells[i].balance) : acc), 0),
  );
}

// Totaux tous groupes confondus, par mois (somme des sous-totaux de section).
export function grandTotals(sections: HistorySection[], monthCount: number): MonthCell[] {
  return Array.from({ length: monthCount }, (_, i) =>
    sections.reduce(
      (acc, s) => {
        const c = s.totals[i];
        return {
          budgeted: acc.budgeted + c.budgeted,
          depense: acc.depense + c.depense,
          recu: acc.recu + c.recu,
          balance: acc.balance + c.balance,
        };
      },
      emptyCell(),
    ),
  );
}
