import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";
import type { Group, Txn } from "./forecast";

// depense et recu séparés selon le sens du groupe (une seule des deux est non nulle
// pour une ligne ; les sous-totaux additionnent les deux). balance = « Reste » de
// budget = budget − dépensé pour les dépenses, 0 pour les entrées et le non catégorisé
// (une entrée d'argent n'a pas de budget, donc pas de reste).
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
  incomeKind: "principal" | "supplementary" | null; // classe de revenu (null hors rémunération)
  cells: MonthCell[]; // alignées sur la liste des mois passée à computeHistory
  subRows: HistorySubRow[]; // lignes des récurrents (vide pour une enveloppe)
  txns: HistoryTxn[]; // transactions directement sous le groupe (enveloppe, ou récurrent sans ligne)
};
export type HistorySection = {
  kind: "income" | "envelope" | "recurring" | "uncategorized";
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

  // projectFuture=false : la ligne n'est pas anticipée sur les mois futurs (réalisé
  // projeté = 0). Utilisé pour la rémunération supplémentaire (couvre le mois courant,
  // pas les suivants).
  const cellsFor = (
    budgeted: number,
    isOut: boolean,
    overspend: number,
    realizedOf: (m: string) => number,
    projectFuture = true,
  ): MonthCell[] =>
    months.map((m) => {
      const realized = m > currentMonth ? (projectFuture ? budgeted + overspend : 0) : realizedOf(m);
      return {
        budgeted,
        depense: isOut ? realized : 0,
        recu: isOut ? 0 : realized,
        // Le Reste ne concerne que les dépenses (budget − dépensé). Une entrée
        // d'argent n'a pas de budget, donc son Reste est nul : le reçu ne doit
        // jamais être soustrait d'un « reste de budget ».
        balance: isOut ? budgeted - realized : 0,
      };
    });

  const rowFor = (g: Group): HistoryRow => {
    const budgeted = budgetOf(g);
    const isOut = g.direction === "out";
    // La supplémentaire n'est pas projetée sur les mois futurs (cf. Global Constraints).
    const projectFuture = !(g.direction === "in" && g.incomeKind === "supplementary");
    // Transactions du groupe (possédées, non exclues), récentes d'abord.
    const mine = owned
      .filter((o) => o.ownerId === g.id)
      .map((o) => o.t)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // Dépassement du mois courant, reporté sur les projections (comme le Prévisionnel).
    const overspend = isOut ? Math.max(0, spent(g.id, currentMonth) - budgeted) : 0;
    const cells = cellsFor(budgeted, isOut, overspend, (m) => spent(g.id, m), projectFuture);

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

    return { id: g.id, name: g.name, kind: g.kind, direction: g.direction, incomeKind: g.incomeKind ?? null, cells, subRows, txns: groupTxns };
  };

  const sumRows = (rows: HistoryRow[]): MonthCell[] =>
    months.map((_, i) =>
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

  // Rémunérations (sens « in ») : présentées au niveau des sections, tout en haut
  // du tableau, principale avant supplémentaire.
  const incomeRank = (g: Group) => (g.incomeKind === "principal" ? 0 : g.incomeKind === "supplementary" ? 1 : 2);
  const incomeSection = (): HistorySection | null => {
    const rows = groups
      .filter((g) => g.direction === "in")
      .sort((a, b) => incomeRank(a) - incomeRank(b))
      .map(rowFor);
    if (rows.length === 0) return null;
    // Le Budget du total de la section ne porte que la rémunération principale
    // (cf. Global Constraints : colonne Budget, supplémentaire = vide). Les
    // autres colonnes (dépensé/reçu/reste) restent la somme de toutes les lignes.
    const totals = sumRows(rows).map((c, i) => ({
      ...c,
      budgeted: rows.filter((r) => r.incomeKind === "principal").reduce((s, r) => s + r.cells[i].budgeted, 0),
    }));
    return { kind: "income", rows, totals };
  };

  // Sections de dépenses : uniquement les groupes de sortie ; les rémunérations
  // sont sorties dans leur propre section (voir incomeSection).
  const section = (kind: "envelope" | "recurring"): HistorySection | null => {
    const rows = groups.filter((g) => g.kind === kind && g.direction === "out").map(rowFor);
    if (rows.length === 0) return null;
    return { kind, rows, totals: sumRows(rows) };
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
      // Aucun budget sur les non catégorisés : pas de « reste » (0), et surtout
      // l'argent reçu n'est pas soustrait.
      return { budgeted: 0, depense, recu, balance: 0 };
    });
    return { kind: "uncategorized", rows: [], totals, txns: mine.map(toHistoryTxn) };
  };

  return [incomeSection(), section("recurring"), section("envelope"), uncategorized()].filter(
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

// Solde du compte reconstitué le long du tableau. On part du solde réel fourni
// par la banque (mois courant) : on rembobine pour trouver le solde d'ouverture
// de chaque mois, puis on accumule ligne par ligne, dans l'ordre d'affichage,
// pour la colonne « Solde ». Le bas du mois courant retombe donc, par
// construction, exactement sur le solde de la banque.
export type SoldeColumn = {
  openings: number[];
  closings: number[];
  rowRunning: Record<number, number[]>;
  uncategorizedRunning: number[] | null;
};

const cellNet = (c: MonthCell) => c.recu - c.depense;

export function computeSolde(
  sections: HistorySection[],
  months: string[],
  currentMonth: string,
  balance: number,
): SoldeColumn {
  const n = months.length;
  // Mouvement net affiché par mois = somme des sous-totaux de section
  // (entrées - sorties). Inclut déjà les non catégorisés et les projections.
  const net = months.map((_, i) => sections.reduce((s, sec) => s + cellNet(sec.totals[i]), 0));

  const openings = new Array<number>(n).fill(0);
  const closings = new Array<number>(n).fill(0);

  // Ancre : le mois courant se ferme sur le solde réel de la banque. S'il est
  // hors de la plage affichée, on ancre sur la borne la plus proche.
  if (n > 0) {
    let ci = months.indexOf(currentMonth);
    if (ci === -1 && currentMonth < months[0]) {
      // Fenêtre entièrement future : le solde d'aujourd'hui est l'ouverture du 1er mois.
      openings[0] = balance;
      closings[0] = balance + net[0];
      for (let i = 1; i < n; i++) {
        openings[i] = closings[i - 1];
        closings[i] = openings[i] + net[i];
      }
    } else {
      // Mois courant dans la plage, ou plage entièrement passée : on ancre le
      // solde de fin sur le mois courant (ou, hors plage, sur la borne haute).
      if (ci === -1) ci = n - 1;
      closings[ci] = balance;
      openings[ci] = balance - net[ci];
      for (let i = ci - 1; i >= 0; i--) {
        closings[i] = openings[i + 1];
        openings[i] = closings[i] - net[i];
      }
      for (let i = ci + 1; i < n; i++) {
        openings[i] = closings[i - 1];
        closings[i] = openings[i] + net[i];
      }
    }
  }

  // Accumulation ligne par ligne, dans l'ordre d'affichage des sections.
  const rowRunning: Record<number, number[]> = {};
  let uncategorizedRunning: number[] | null = null;
  for (let i = 0; i < n; i++) {
    let run = openings[i];
    for (const sec of sections) {
      if (sec.kind === "uncategorized") {
        run += cellNet(sec.totals[i]);
        (uncategorizedRunning ??= new Array<number>(n).fill(0))[i] = run;
      } else {
        for (const r of sec.rows) {
          run += cellNet(r.cells[i]);
          (rowRunning[r.id] ??= new Array<number>(n).fill(0))[i] = run;
        }
      }
    }
  }

  return { openings, closings, rowRunning, uncategorizedRunning };
}

// Revenu projeté d'une ligne pour un mois : montant de la principale (tous mois),
// montant de la supplémentaire au mois courant seulement, 0 pour une dépense.
function rowRevenus(r: HistoryRow, i: number, isCurrent: boolean): number {
  if (r.direction !== "in") return 0;
  if (r.incomeKind === "supplementary") return isCurrent ? r.cells[i].budgeted : 0;
  return r.cells[i].budgeted;
}

// Budget de dépense d'une ligne (0 pour une entrée). budgeted est constant sur les mois.
function rowBudget(r: HistoryRow, i: number): number {
  return r.direction === "out" ? r.cells[i].budgeted : 0;
}

// Dépassement maintenu d'une ligne = dépassement réel constaté au mois courant.
function rowOverspend(r: HistoryRow, ci: number): number {
  if (r.direction !== "out") return 0;
  return Math.max(0, r.cells[ci].depense - r.cells[ci].budgeted);
}

export type PlannedSoldes = {
  prevuClosings: (number | null)[];
  depassClosings: (number | null)[];
  prevuRowRunning: Record<number, (number | null)[]>;
  depassRowRunning: Record<number, (number | null)[]>;
};

// Chaînes de solde « plan » : prévu (revenus − budget) et « si dépassement »
// (prévu − dépassement), ancrées à l'argent de départ réel du mois courant et
// enchaînées vers le futur. Nulles avant le mois courant (colonnes non affichées).
export function computePlannedSoldes(
  sections: HistorySection[], months: string[], currentMonth: string, openingsReal: number[],
): PlannedSoldes {
  const n = months.length;
  let ci = months.indexOf(currentMonth);
  if (ci === -1) ci = n > 0 && currentMonth < months[0] ? 0 : n - 1;

  const prevuClosings = new Array<number | null>(n).fill(null);
  const depassClosings = new Array<number | null>(n).fill(null);
  const prevuRowRunning: Record<number, (number | null)[]> = {};
  const depassRowRunning: Record<number, (number | null)[]> = {};
  for (const sec of sections) for (const r of sec.rows) {
    prevuRowRunning[r.id] = new Array<number | null>(n).fill(null);
    depassRowRunning[r.id] = new Array<number | null>(n).fill(null);
  }
  if (n === 0 || ci >= n) return { prevuClosings, depassClosings, prevuRowRunning, depassRowRunning };

  for (let i = ci; i < n; i++) {
    const isCurrent = months[i] === currentMonth;
    let runP = i === ci ? openingsReal[ci] : prevuClosings[i - 1]!;
    let runD = i === ci ? openingsReal[ci] : depassClosings[i - 1]!;
    for (const sec of sections) {
      // Non catégorisés exclus du plan (aucun budget/revenu planifié).
      if (sec.kind === "uncategorized") continue;
      for (const r of sec.rows) {
        const net = rowRevenus(r, i, isCurrent) - rowBudget(r, i);
        runP += net;
        runD += net - rowOverspend(r, ci);
        prevuRowRunning[r.id][i] = runP;
        depassRowRunning[r.id][i] = runD;
      }
    }
    prevuClosings[i] = runP;
    depassClosings[i] = runD;
  }
  return { prevuClosings, depassClosings, prevuRowRunning, depassRowRunning };
}
