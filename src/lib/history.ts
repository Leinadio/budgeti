import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";
import type { Group, Txn } from "./forecast";

// depense et recu séparés selon le sens du groupe (une seule des deux est non nulle
// pour une ligne ; les sous-totaux additionnent les deux). balance = budgeted - réalisé.
export type MonthCell = { budgeted: number; depense: number; recu: number; balance: number };
export type HistoryRow = {
  id: number;
  name: string;
  kind: "envelope" | "recurring";
  direction: "in" | "out";
  cells: MonthCell[]; // alignées sur la liste des mois passée à computeHistory
};
export type HistorySection = {
  kind: "envelope" | "recurring";
  rows: HistoryRow[];
  totals: MonthCell[];
};

// Mois distincts « YYYY-MM » présents dans les transactions, triés croissant.
export function monthsWithData(txns: Txn[]): string[] {
  const set = new Set<string>();
  for (const t of txns) set.add(t.date.slice(0, 7));
  return [...set].sort();
}

export function nextMonthKey(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
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
    const ownerId = res.status === "manual" || res.status === "auto" ? res.groupId : null;
    return { t, ownerId, month: t.date.slice(0, 7) };
  });

  const spent = (gid: number, m: string) =>
    owned.filter((o) => o.ownerId === gid && o.month === m).reduce((s, o) => s + Math.abs(o.t.amount), 0);

  const rowFor = (g: Group): HistoryRow => {
    const budgeted = budgetOf(g);
    const isOut = g.direction === "out";
    // Dépassement du mois courant, reporté sur les projections (comme le Prévisionnel).
    const overspend = isOut ? Math.max(0, spent(g.id, currentMonth) - budgeted) : 0;
    const cells = months.map((m) => {
      const realized = m > currentMonth ? budgeted + overspend : spent(g.id, m);
      return {
        budgeted,
        depense: isOut ? realized : 0,
        recu: isOut ? 0 : realized,
        balance: budgeted - realized,
      };
    });
    return { id: g.id, name: g.name, kind: g.kind, direction: g.direction, cells };
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

  return [section("envelope"), section("recurring")].filter((s): s is HistorySection => s !== null);
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
