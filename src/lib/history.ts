import { resolveOwnership, type OwnableGroup, type OwnedTxn } from "./ownership";
import { type Group, type Txn, isGroupAlive, isLineAlive } from "./forecast";

// Montants en vigueur (budgets et lignes datés) : déplacés dans budget-in-force.ts
// pour éviter un cycle d'import avec forecast.ts (qui a aussi besoin de ces
// fonctions). Ré-exportés ici pour ne pas casser les consommateurs existants.
export {
  lineAmountInForce, budgetInForce, provisionInForce, toDatedBudgets,
  toDatedLineAmounts, lineStarted, budgetKey, budgetsByMonth, amountInForce,
  type DatedBudgets, type DatedLineAmounts, type DatedEntry, type BudgetScope,
} from "./budget-in-force";
import {
  lineAmountInForce, budgetInForce, provisionInForce, lineStarted,
  type DatedBudgets, type DatedLineAmounts,
} from "./budget-in-force";

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
  // Commentaire libre de l'utilisateur, affiché sous le libellé (cf. txn-comment.ts).
  comment?: string | null;
};
// Un sous-groupe = une ligne d'un récurrent (Spotify, Direct Assurance…).
export type HistorySubRow = {
  id: number;
  name: string;
  cells: MonthCell[]; // alignées sur les mois
  // Aligné sur les mois : la ligne a-t-elle déjà un montant à elle ce mois-là
  // (au moins une entrée datée à ou avant), ET son groupe est-il vivant ce
  // mois-là. Distinct de l'aliveMonths du groupe : une ligne ajoutée après le
  // début d'un groupe encore vivant n'est « vivante » qu'à partir de sa propre
  // première entrée (cf. lineStarted) : c'est ce qui permet de distinguer partout
  // sa naissance d'une vraie hausse de son montant.
  aliveMonths: boolean[];
  txns: HistoryTxn[]; // transactions rattachées à cette ligne
};
export type HistoryRow = {
  id: number;
  name: string;
  direction: "in" | "out";
  incomeKind: "principal" | "supplementary" | null; // classe de revenu (null hors rémunération)
  cells: MonthCell[]; // alignées sur la liste des mois passée à computeHistory
  aliveMonths: boolean[]; // aligné sur months : le groupe est-il vivant ce mois-là
  subRows: HistorySubRow[]; // sous-postes de la dépense (vide si elle est plate)
  txns: HistoryTxn[]; // transactions posées directement sur le groupe (dépense plate)
};
export type HistorySection = {
  // Une seule section pour toutes les dépenses : « récurrent » et « enveloppe »
  // promettaient deux comportements et n'en donnaient qu'un. Ce qui les distinguait —
  // avoir des sous-postes ou non — se lit ligne par ligne (HistoryRow.subRows).
  kind: "income" | "expense" | "uncategorized";
  rows: HistoryRow[];
  totals: MonthCell[];
  txns?: HistoryTxn[]; // uniquement pour « uncategorized » : liste plate
  // Uniquement pour « uncategorized » : sens des transactions de la section.
  // Les non catégorisés sont scindés en deux : les reçus (« in », affichés sous les
  // rémunérations) et les dépenses (« out », affichées après les enveloppes).
  uncatDirection?: "in" | "out";
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

function toOwnable(g: Group): OwnableGroup {
  return { id: g.id, accountId: g.accountId, direction: g.direction };
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
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): HistorySection[] {
  const ownable = groups.map(toOwnable);
  const owned = txns.map((t) => {
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    const month = t.date.slice(0, 7);
    const g = res.status === "manual" ? groups.find((x) => x.id === res.groupId) : undefined;
    const ownerId = g && isGroupAlive(g, month) ? g.id : null;
    return { t, ownerId, month };
  });

  const spent = (gid: number, m: string) =>
    owned.filter((o) => o.ownerId === gid && o.month === m).reduce((s, o) => s + Math.abs(o.t.amount), 0);

  // Rattache une transaction d'un récurrent à une de ses lignes uniquement via
  // le line_id manuel ; sinon elle reste directement sous le groupe.
  const lineOf = (g: Group, t: Txn): number | null =>
    t.lineId != null && g.lines.some((l) => l.id === t.lineId) ? t.lineId : null;

  const toHistoryTxn = (t: Txn): HistoryTxn => ({
    id: t.id, date: t.date, label: t.label, amount: t.amount, month: t.date.slice(0, 7),
    groupId: t.groupId, lineId: t.lineId ?? null, comment: t.comment ?? null,
  });

  // On ne liste que les transactions des mois affichés.
  const inRange = (t: Txn) => months.includes(t.date.slice(0, 7));

  // Mois futurs : rien n'est encore réalisé (dépensé / reçu à 0, Balance = budget
  // entier). Les projections vivent dans les chaînes de plan (Solde prévu / si
  // dépassement), pas dans les cellules réelles.
  const cellsFor = (
    budgetedOf: (m: string) => number,
    isOut: boolean,
    realizedOf: (m: string) => number,
  ): MonthCell[] =>
    months.map((m) => {
      const budgeted = budgetedOf(m);
      const realized = m > currentMonth ? 0 : realizedOf(m);
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
    const isOut = g.direction === "out";
    // Transactions du groupe (possédées, non exclues), récentes d'abord.
    const mine = owned
      .filter((o) => o.ownerId === g.id)
      .map((o) => o.t)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const cells = cellsFor((m) => (isGroupAlive(g, m) ? budgetInForce(g, m, dated, datedLines) : 0), isOut, (m) => spent(g.id, m));
    const aliveMonths = months.map((m) => isGroupAlive(g, m));

    // Sous-groupes : une ligne par poste du récurrent ; les projections gardent
    // juste le budget de la ligne (pas de dépassement au niveau ligne).
    const subRows: HistorySubRow[] = g.lines.map((l) => {
      const lineTxns = mine.filter((t) => lineOf(g, t) === l.id);
      const realizedOf = (m: string) =>
        lineTxns.filter((t) => t.date.slice(0, 7) === m).reduce((s, t) => s + Math.abs(t.amount), 0);
      return {
        id: l.id,
        name: l.name,
        // La ligne doit vivre ce mois-là ET son groupe avec elle : une ligne bornée à
        // juillet ne budgète rien en août, même si le récurrent qui la porte continue.
        cells: cellsFor((m) => (isGroupAlive(g, m) && isLineAlive(l, m) ? lineAmountInForce(l.id, m, datedLines) : 0), isOut, realizedOf),
        aliveMonths: months.map((m) => isGroupAlive(g, m) && isLineAlive(l, m) && lineStarted(l.id, m, datedLines)),
        txns: lineTxns.filter(inRange).map(toHistoryTxn),
      };
    });

    // Transactions directement sous le groupe : enveloppe (pas de lignes) ou
    // récurrent dont la transaction ne matche aucune ligne.
    const groupTxns = mine.filter((t) => lineOf(g, t) === null && inRange(t)).map(toHistoryTxn);

    return { id: g.id, name: g.name, direction: g.direction, incomeKind: g.incomeKind ?? null, cells, aliveMonths, subRows, txns: groupTxns };
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
      .filter((g) => months.some((m) => isGroupAlive(g, m)))
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

  // La section des dépenses : tous les groupes de sortie, dans l'ordre reçu (celui
  // du nom, déjà trié par listGroups). Les rémunérations ont leur propre section
  // (voir incomeSection).
  const expenseSection = (): HistorySection | null => {
    const rows = groups
      .filter((g) => g.direction === "out")
      .filter((g) => months.some((m) => isGroupAlive(g, m)))
      .map(rowFor);
    if (rows.length === 0) return null;
    return { kind: "expense", rows, totals: sumRows(rows) };
  };

  // Reçus non catégorisés d'un mois (section « in »), indépendamment de la
  // direction demandée à `uncategorized` ci-dessous : sert à ce que la Balance
  // stockée de la section « out » inclue les remboursements croisés, comme le
  // Reste recomposé et affiché dans la grille (history-grid.tsx, resteVal).
  const uncatInRecuOf = (m: string): number =>
    owned
      .filter((o) => o.ownerId === null && o.t.amount > 0 && o.t.date.slice(0, 7) === m)
      .reduce((s, o) => s + o.t.amount, 0);

  // Transactions sans groupe, scindées par sens : les reçus (« in », affichés sous
  // les rémunérations) et les dépenses (« out », affichées après les enveloppes).
  const uncategorized = (direction: "in" | "out"): HistorySection | null => {
    const mine = owned
      .filter((o) => o.ownerId === null && inRange(o.t) && (direction === "in" ? o.t.amount > 0 : o.t.amount < 0))
      .map((o) => o.t)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (mine.length === 0) return null;
    const totals = months.map((m) => {
      const monthTxns = mine.filter((t) => t.date.slice(0, 7) === m);
      const depense = monthTxns.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      const recu = monthTxns.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      // Les dépenses non catégorisées reçoivent la provision (budget daté du groupe 0)
      // comme budget : la Balance devient provision + reçus non catégorisés (section
      // « in ») − dépensé, comme une enveloppe. Le `recu` de CETTE section (« out »)
      // est toujours 0 (elle ne contient que les sorties) : sans les reçus croisés de
      // la section « in », la Balance stockée sous-estimerait le Reste réellement
      // affiché (cf. resteVal dans history-grid.tsx, qui fait le même calcul).
      // Les reçus non catégorisés, eux, n'ont toujours pas de budget (0, reste à 0) :
      // l'argent reçu sans groupe n'est jamais soustrait d'un « reste ».
      if (direction === "out") {
        const budgeted = provisionInForce(dated, m);
        return { budgeted, depense, recu, balance: budgeted + uncatInRecuOf(m) - depense };
      }
      return { budgeted: 0, depense, recu, balance: 0 };
    });
    return { kind: "uncategorized", rows: [], totals, txns: mine.map(toHistoryTxn), uncatDirection: direction };
  };

  return [incomeSection(), uncategorized("in"), expenseSection(), uncategorized("out")].filter(
    (s): s is HistorySection => s !== null,
  );
}

// Un bloc « Non comptabilisées » : les transactions mises hors calcul par
// l'utilisateur, pour un sens donné. Volontairement un type à part, et non une
// HistorySection : ces montants ne doivent entrer dans aucun total du tableau
// (grandTotals, monthlyOverspend, chaînes de solde). Le bloc n'existe que pour
// être affiché en bas de la grille.
export type IgnoredBlock = {
  direction: "in" | "out";
  totals: { depense: number; recu: number }[]; // alignés sur months
  txns: HistoryTxn[]; // récentes d'abord
};

// Scinde les transactions non comptabilisées des mois affichés en deux blocs,
// reçus puis dépenses. Un bloc sans transaction n'est pas produit.
export function computeIgnoredBlocks(txns: Txn[], months: string[]): IgnoredBlock[] {
  const blockFor = (direction: "in" | "out"): IgnoredBlock | null => {
    const mine = txns
      .filter((t) => months.includes(t.date.slice(0, 7)))
      .filter((t) => (direction === "in" ? t.amount > 0 : t.amount < 0))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (mine.length === 0) return null;
    const totals = months.map((m) => {
      const sum = mine
        .filter((t) => t.date.slice(0, 7) === m)
        .reduce((s, t) => s + Math.abs(t.amount), 0);
      return { depense: direction === "out" ? sum : 0, recu: direction === "in" ? sum : 0 };
    });
    return {
      direction,
      totals,
      txns: mine.map((t) => ({
        id: t.id, date: t.date, label: t.label, amount: t.amount,
        month: t.date.slice(0, 7), groupId: t.groupId, lineId: t.lineId ?? null,
      })),
    };
  };
  return [blockFor("in"), blockFor("out")].filter((b): b is IgnoredBlock => b !== null);
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
  // Solde couru des deux étapes « non catégorisés » (reçus / dépenses), par sens.
  uncategorizedRunning: { in?: number[]; out?: number[] } | null;
};

const cellNet = (c: MonthCell) => c.recu - c.depense;

export function computeSolde(
  sections: HistorySection[],
  months: string[],
  currentMonth: string,
  balance: number,
  // Estimé de fin du mois courant : s'il est fourni, les mois futurs partent de
  // cette estimation (au lieu du solde « maintenant ») pour la colonne Solde réel.
  currentEstimate?: number | null,
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
      // Fenêtre entièrement future : l'ouverture du 1er mois est l'estimé de fin du
      // mois courant (s'il est fourni), sinon le solde d'aujourd'hui.
      openings[0] = currentEstimate ?? balance;
      closings[0] = openings[0] + net[0];
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
        // Premier mois futur : il s'ouvre sur l'estimé de fin du mois courant
        // (si fourni), pas sur le solde « maintenant » de la banque.
        openings[i] = i === ci + 1 && currentEstimate != null ? currentEstimate : closings[i - 1];
        closings[i] = openings[i] + net[i];
      }
    }
  }

  // Accumulation ligne par ligne, dans l'ordre d'affichage des sections.
  const rowRunning: Record<number, number[]> = {};
  let uncategorizedRunning: { in?: number[]; out?: number[] } | null = null;
  for (let i = 0; i < n; i++) {
    let run = openings[i];
    for (const sec of sections) {
      if (sec.kind === "uncategorized") {
        run += cellNet(sec.totals[i]);
        const key = sec.uncatDirection ?? "out";
        uncategorizedRunning ??= {};
        (uncategorizedRunning[key] ??= new Array<number>(n).fill(0))[i] = run;
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
// Exportée : la grille et le side panel doivent projeter EXACTEMENT la même règle
// que les chaînes de solde ci-dessous, sinon le détail ne retombe pas sur la case.
export function rowRevenus(r: HistoryRow, i: number, isCurrent: boolean): number {
  if (r.direction !== "in") return 0;
  if (r.incomeKind === "supplementary") return isCurrent ? r.cells[i].budgeted : 0;
  return r.cells[i].budgeted;
}

// Budget de dépense d'une ligne (0 pour une entrée), au mois d'index i : il varie
// d'un mois à l'autre, chaque groupe portant une suite de montants datés.
function rowBudget(r: HistoryRow, i: number): number {
  return r.direction === "out" ? r.cells[i].budgeted : 0;
}

// Dépassement d'une ligne au mois d'index ci : part dépensée au-delà du budget.
// Exportée pour la même raison que rowRevenus : le « Dépassement » lu dans le side
// panel doit être celui-là même que retire la chaîne « si dépassement ».
export function rowOverspend(r: HistoryRow, ci: number): number {
  if (r.direction !== "out") return 0;
  const c = r.cells[ci];
  if (!c) return 0;
  return Math.max(0, c.depense - c.budgeted);
}

export type PlannedSoldes = {
  prevuClosings: (number | null)[];
  depassClosings: (number | null)[];
  prevuRowRunning: Record<number, (number | null)[]>;
  depassRowRunning: Record<number, (number | null)[]>;
  // Valeurs courues des chaînes au niveau des deux étapes « non catégorisés »
  // (reçus / dépenses). Le prévu les traverse sans changer (rien de planifié) ;
  // le « si dépassement » retire, à l'étape dépenses, leur débordement net
  // (dépensé au-delà des reçus non catégorisés), maintenu sur les mois futurs.
  uncatPrevuRunning: { in?: (number | null)[]; out?: (number | null)[] };
  uncatDepassRunning: { in?: (number | null)[]; out?: (number | null)[] };
};

// --- Découpe d'affichage ----------------------------------------------------
// Quand la fenêtre choisie commence après le mois courant, les chaînes de solde
// doivent quand même être calculées depuis le mois courant (leur ancre). La page
// calcule donc sur une plage étendue, puis ne garde que les k derniers mois pour
// l'affichage : ces fonctions retirent les k premiers mois de chaque structure.

export function sliceHistorySections(sections: HistorySection[], calcMonths: string[], k: number): HistorySection[] {
  if (k === 0) return sections;
  const keep = new Set(calcMonths.slice(k));
  return sections.map((sec) => ({
    ...sec,
    rows: sec.rows.map((r) => ({
      ...r,
      cells: r.cells.slice(k),
      aliveMonths: r.aliveMonths.slice(k),
      subRows: r.subRows.map((s) => ({ ...s, cells: s.cells.slice(k), aliveMonths: s.aliveMonths.slice(k), txns: s.txns.filter((t) => keep.has(t.month)) })),
      txns: r.txns.filter((t) => keep.has(t.month)),
    })),
    totals: sec.totals.slice(k),
    txns: sec.txns?.filter((t) => keep.has(t.month)),
  }));
}

export function sliceSoldeColumn(s: SoldeColumn, k: number): SoldeColumn {
  if (k === 0) return s;
  const rec = (r: Record<number, number[]>) =>
    Object.fromEntries(Object.entries(r).map(([id, arr]) => [id, arr.slice(k)]));
  return {
    openings: s.openings.slice(k),
    closings: s.closings.slice(k),
    rowRunning: rec(s.rowRunning),
    uncategorizedRunning: s.uncategorizedRunning
      ? { in: s.uncategorizedRunning.in?.slice(k), out: s.uncategorizedRunning.out?.slice(k) }
      : null,
  };
}

export function slicePlannedSoldes(p: PlannedSoldes, k: number): PlannedSoldes {
  if (k === 0) return p;
  const rec = (r: Record<number, (number | null)[]>) =>
    Object.fromEntries(Object.entries(r).map(([id, arr]) => [id, arr.slice(k)]));
  return {
    prevuClosings: p.prevuClosings.slice(k),
    depassClosings: p.depassClosings.slice(k),
    prevuRowRunning: rec(p.prevuRowRunning),
    depassRowRunning: rec(p.depassRowRunning),
    uncatPrevuRunning: { in: p.uncatPrevuRunning.in?.slice(k), out: p.uncatPrevuRunning.out?.slice(k) },
    uncatDepassRunning: { in: p.uncatDepassRunning.in?.slice(k), out: p.uncatDepassRunning.out?.slice(k) },
  };
}

// Estimé de fin du mois courant, aligné sur le tableau : solde réel actuel, plus
// les rémunérations restant à recevoir (budget affiché − déjà reçu), moins les
// Balances vertes non nulles (budget restant des groupes de dépense, qu'on suppose
// dépensé d'ici la fin du mois). null si le mois courant n'est pas dans la plage.
export type EstimateStep = { id: number; name: string; amount: number };
export function computeTableEstimate(
  sections: HistorySection[], months: string[], currentMonth: string, balance: number,
): { value: number; incomeSteps: EstimateStep[]; spendSteps: EstimateStep[] } | null {
  const ci = months.indexOf(currentMonth);
  if (ci === -1) return null;
  const incomeSteps: EstimateStep[] = [];
  const spendSteps: EstimateStep[] = [];
  for (const sec of sections) {
    for (const r of sec.rows) {
      if (r.direction === "in") {
        const due = rowRevenus(r, ci, true) - r.cells[ci].recu;
        if (due > 0.005) incomeSteps.push({ id: r.id, name: r.name, amount: due });
      } else {
        const rest = r.cells[ci].balance;
        if (rest > 0.005) spendSteps.push({ id: r.id, name: r.name, amount: rest });
      }
    }
  }
  const value =
    balance + incomeSteps.reduce((s, x) => s + x.amount, 0) - spendSteps.reduce((s, x) => s + x.amount, 0);
  return { value, incomeSteps, spendSteps };
}

// Débordement net des non catégorisés pour un mois : dépensé (section « out »)
// au-delà des reçus (section « in ») et de la provision en vigueur. C'est la part
// rouge de leur Balance. `outT.budgeted` porte déjà la provision (posée par
// `computeHistory`), donc ce calcul retourne exactement l'excès au-delà d'elle.
export function uncatOverspend(sections: HistorySection[], i: number): number {
  const outT = sections.find((s) => s.kind === "uncategorized" && (s.uncatDirection ?? "out") === "out")?.totals[i];
  const inT = sections.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in")?.totals[i];
  return uncatOverspendOf(outT, inT);
}

// Même règle, à partir des deux totaux déjà en main (la grille les a sous la main
// quand elle rend la ligne « Non catégorisés » : inutile de rechercher les sections).
export function uncatOverspendOf(outT?: MonthCell, inT?: MonthCell): number {
  return Math.max(0, (outT?.depense ?? 0) - (inT?.recu ?? 0) - (outT?.budgeted ?? 0));
}

// Dépassements par (ce qui porte un budget) x mois, groupés par mois.
//
// Un dépassement se signale, il ne se tranche pas : l'app dit qu'il a eu lieu, et c'est
// tout. Relever un budget pour la suite est un geste à part, que l'utilisateur fait dans
// les cases des mois qu'il veut changer — un dépassement ne modifie donc jamais un
// budget tout seul, ni ne se reconduit sur le prévisionnel.
//
// lineId : la ligne d'un récurrent qui déborde, null pour une enveloppe et pour les
// non catégorisés. Un récurrent n'a pas de budget à lui — son budget est la somme de
// ses lignes — donc c'est chaque LIGNE qui déborde ou non. Le groupe n'apparaît jamais
// ici. Depuis que toute dépense d'un récurrent appartient forcément à une de ses lignes
// (canAttachToGroup), la somme des débordements de lignes couvre tout ce que le groupe
// peut déborder : aucun dépassement ne peut échapper à ce découpage.
// `name` est celui de ce qui déborde — le nom de la ligne, donc, pour un récurrent.
export type Overspend = {
  groupId: number;
  lineId: number | null;
  name: string;
  month: string;
  amount: number;
};

export function computeOverspends(
  groups: Group[],
  txns: Txn[],
  currentMonth: string,
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): { byMonth: Record<string, Overspend[]> } {
  const ownable = groups.map(toOwnable);
  const owned = txns.map((t) => {
    const o: OwnedTxn = { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded };
    const res = resolveOwnership(o, ownable);
    const month = t.date.slice(0, 7);
    const g = res.status === "manual" ? groups.find((x) => x.id === res.groupId) : undefined;
    return { t, ownerId: g && isGroupAlive(g, month) ? g.id : null, month };
  });
  // Un mois à venir n'a rien de réel : aucune dépense n'y a encore eu lieu.
  const months = monthsWithData(txns).filter((m) => m <= currentMonth);

  const byMonth: Record<string, Overspend[]> = {};
  const noter = (item: Overspend) => {
    (byMonth[item.month] ??= []).push(item);
  };
  for (const m of months) {
    for (const g of groups) {
      if (g.direction !== "out") continue;
      if (!isGroupAlive(g, m)) continue;
      if (g.lines.length > 0) {
        // Sous-poste par sous-poste : chacun a son budget daté et sa propre dépense.
        for (const l of g.lines) {
          const spent = owned
            .filter((o) => o.ownerId === g.id && o.t.lineId === l.id && o.month === m)
            .reduce((s, o) => s + Math.abs(o.t.amount), 0);
          const os = Math.max(0, spent - lineAmountInForce(l.id, m, datedLines));
          if (os <= 0.005) continue;
          noter({ groupId: g.id, lineId: l.id, name: l.name, month: m, amount: os });
        }
        continue;
      }
      const spent = owned.filter((o) => o.ownerId === g.id && o.month === m).reduce((s, o) => s + Math.abs(o.t.amount), 0);
      const os = Math.max(0, spent - budgetInForce(g, m, dated, datedLines));
      if (os <= 0.005) continue;
      noter({ groupId: g.id, lineId: null, name: g.name, month: m, amount: os });
    }
    const uncat = owned.filter((o) => o.ownerId === null && o.month === m);
    const dep = uncat.filter((o) => o.t.amount < 0).reduce((s, o) => s + Math.abs(o.t.amount), 0);
    const rec = uncat.filter((o) => o.t.amount > 0).reduce((s, o) => s + o.t.amount, 0);
    const os = Math.max(0, dep - rec - provisionInForce(dated, m));
    if (os > 0.005) noter({ groupId: 0, lineId: null, name: "Non catégorisés", month: m, amount: os });
  }
  // Tri par nom, pour un bandeau et des étiquettes stables.
  for (const m of Object.keys(byMonth)) byMonth[m].sort((a, b) => a.name.localeCompare(b.name));
  return { byMonth };
}

// Cases qui portent un dépassement — clés « groupe::ligne::mois », la ligne valant 0
// pour une enveloppe et les non catégorisés. C'est la seule source de l'étiquette
// affichée sous un montant : la lire ici et nulle part ailleurs est ce qui fait qu'un
// dépassement acquitté (« Vu ») perd son étiquette, puisqu'il quitte cette liste.
export function overspentCells(byMonth: Record<string, Overspend[]>): Set<string> {
  const out = new Set<string>();
  for (const [month, items] of Object.entries(byMonth)) {
    for (const it of items) out.add(`${it.groupId}::${it.lineId ?? 0}::${month}`);
  }
  return out;
}

// Groupes qui ont un dépassement, par mois — clés « groupe::mois ». Un groupe récurrent
// ne déborde pas lui-même : ce sont ses lignes. Mais replié, aucune de ses lignes n'est
// visible, et rien ne dirait qu'il y a un dépassement chez lui : sa case Balance porte
// donc l'étiquette, comme un signal de ce qu'il contient.
export function groupsWithPending(byMonth: Record<string, Overspend[]>): Set<string> {
  const out = new Set<string>();
  for (const [month, items] of Object.entries(byMonth)) {
    for (const it of items) out.add(`${it.groupId}::${month}`);
  }
  return out;
}

// Chaînes de solde « plan » : prévu (revenus − budget) et « si dépassement »
// (prévu − dépassement). Mois passés et courant : ancrés à l'argent de départ réel
// du mois, dépassement du mois lui-même. Mois futurs : le premier part de l'estimé
// de fin du mois courant (currentEstimate, sinon la clôture du plan), les suivants
// enchaînent ; aucun dépassement n'y est plus supposé (plus de report), le « si
// dépassement » y rejoint donc le « prévu ». Les non catégorisés entrent dans le
// prévu via leur provision (une dépense planifiée, comme un budget d'enveloppe), et
// leur débordement net au-delà de la provision est retiré de la chaîne « si
// dépassement » (à leur étape « dépenses », après les enveloppes) : la colonne se
// lit ainsi en continu jusqu'au « Solde actuel ».
export function computePlannedSoldes(
  sections: HistorySection[], months: string[], currentMonth: string, openingsReal: number[],
  currentEstimate?: number | null, dated?: DatedBudgets,
): PlannedSoldes {
  const n = months.length;
  let ci = months.indexOf(currentMonth);
  if (ci === -1) ci = n > 0 && currentMonth < months[0] ? 0 : n - 1;

  const prevuClosings = new Array<number | null>(n).fill(null);
  const depassClosings = new Array<number | null>(n).fill(null);
  const prevuRowRunning: Record<number, (number | null)[]> = {};
  const depassRowRunning: Record<number, (number | null)[]> = {};
  const uncatPrevuRunning: { in?: (number | null)[]; out?: (number | null)[] } = {};
  const uncatDepassRunning: { in?: (number | null)[]; out?: (number | null)[] } = {};
  for (const sec of sections) for (const r of sec.rows) {
    prevuRowRunning[r.id] = new Array<number | null>(n).fill(null);
    depassRowRunning[r.id] = new Array<number | null>(n).fill(null);
  }
  if (n === 0 || ci >= n)
    return { prevuClosings, depassClosings, prevuRowRunning, depassRowRunning, uncatPrevuRunning, uncatDepassRunning };

  for (let i = 0; i < n; i++) {
    const isCurrent = months[i] === currentMonth;
    // Passé / courant : ancre sur l'ouverture réelle du mois, dépassement du mois.
    // Futur : chaîne sur la clôture du plan, dépassement du mois courant maintenu.
    const anchored = i <= ci;
    // Premier mois futur : les deux chaînes repartent de l'estimé de fin du mois
    // courant (le meilleur point de départ connu), pas de la clôture du plan.
    const futureStart = i === ci + 1 && currentEstimate != null ? currentEstimate : null;
    let runP = anchored ? openingsReal[i] : futureStart ?? prevuClosings[i - 1]!;
    let runD = anchored ? openingsReal[i] : futureStart ?? depassClosings[i - 1]!;
    const osMonth = anchored ? i : ci;
    for (const sec of sections) {
      // « Si dépassement » = une seule chaîne continue de haut en bas : chaque ligne
      // affiche le cumul global runD (solde prévu moins tous les dépassements enchaînés
      // depuis le début du tableau, toutes sections confondues). Le « Solde précédent »
      // d'une ligne est donc toujours le « si dépassement » de la ligne juste au-dessus,
      // et runD pilote aussi les clôtures (pire cas total).
      if (sec.kind === "uncategorized") {
        // À l'étape « dépenses », la provision est une dépense planifiée, retirée du
        // prévu comme un budget d'enveloppe. Le « si dépassement » retire en plus,
        // sur un mois ancré (passé / courant), le débordement net au-delà de la
        // provision ; sur un mois futur, plus aucun report : il rejoint le prévu.
        const dir = sec.uncatDirection ?? "out";
        if (dir === "out") {
          const prov = provisionInForce(dated, months[i]);
          runP -= prov;
          if (anchored) runD -= prov + uncatOverspend(sections, osMonth);
          else runD = runP;
        }
        (uncatPrevuRunning[dir] ??= new Array<number | null>(n).fill(null))[i] = runP;
        (uncatDepassRunning[dir] ??= new Array<number | null>(n).fill(null))[i] = runD;
      } else {
        for (const r of sec.rows) {
          const net = rowRevenus(r, i, isCurrent) - rowBudget(r, i);
          runP += net;
          // Ancré (passé / courant) : dépassement réel du mois. Futur : aucun report.
          const os = anchored ? rowOverspend(r, osMonth) : 0;
          runD += net - os;
          prevuRowRunning[r.id][i] = runP;
          depassRowRunning[r.id][i] = runD;
        }
      }
    }
    prevuClosings[i] = runP;
    depassClosings[i] = runD;
  }
  return { prevuClosings, depassClosings, prevuRowRunning, depassRowRunning, uncatPrevuRunning, uncatDepassRunning };
}
