import type { Group } from "./forecast";

// Budgets datés : pour chaque groupe, la liste de ses montants avec leur mois
// d'entrée en vigueur (triée par mois croissant). Le montant en vigueur pour un
// mois M est celui de la dernière entrée dont effectiveMonth <= M. Sans entrée
// applicable, le montant est 0 : il n'existe PLUS de montant de base sur lequel
// retomber, c'est ce repli qui faisait diverger l'affichage et le calcul.
// La reprise de données garantit une entrée au mois de départ de chaque groupe.
export type DatedBudgets = Record<number, { effectiveMonth: string; amount: number }[]>;

// Même chose pour les lignes d'un récurrent, indexé par identifiant de ligne.
export type DatedLineAmounts = Record<number, { effectiveMonth: string; amount: number }[]>;

// Montant en vigueur d'une ligne de récurrent à `month`, 0 par défaut.
export function lineAmountInForce(lineId: number, month: string, datedLines?: DatedLineAmounts): number {
  let amount = 0;
  for (const b of datedLines?.[lineId] ?? []) if (b.effectiveMonth <= month) amount = b.amount;
  return amount;
}

// Vrai si une ligne a déjà au moins une entrée datée à `month` ou avant : la ligne
// « existe » à ce mois. Une ligne n'a pas de startMonth/endMonth comme un groupe —
// sa vie propre se lit uniquement dans sa suite de montants (addGroupLine pose la
// première entrée au mois de création, pas au début du groupe). Sans ça, un mois
// sans entrée (lineAmountInForce = 0 par repli) serait indiscernable d'une ligne
// dont le montant vaut vraiment 0 ce mois-là.
export function lineStarted(lineId: number, month: string, datedLines?: DatedLineAmounts): boolean {
  return (datedLines?.[lineId] ?? []).some((b) => b.effectiveMonth <= month);
}

// Budget en vigueur d'un groupe à `month`. Un récurrent n'a pas de montant à lui :
// son budget est la somme de ses lignes telles qu'elles sont ce mois-là. Les
// entrées éventuellement posées sur un groupe récurrent sont donc ignorées.
export function budgetInForce(
  g: Group,
  month: string,
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): number {
  if (g.kind === "recurring") {
    return g.lines.reduce((s, l) => s + lineAmountInForce(l.id, month, datedLines), 0);
  }
  let amount = 0;
  for (const b of dated?.[g.id] ?? []) if (b.effectiveMonth <= month) amount = b.amount;
  return amount;
}

// Provision (budget daté du groupe 0 = non catégorisés) en vigueur à `month`, 0 par défaut.
export function provisionInForce(dated: DatedBudgets | undefined, month: string): number {
  let amount = 0;
  for (const b of dated?.[0] ?? []) if (b.effectiveMonth <= month) amount = b.amount;
  return amount;
}

// Décale une clé « YYYY-MM » d'un mois (copie locale pour éviter le cycle avec
// history.ts, qui importe ce module).
function nextMonthKey(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Écritures datées d'un changement de budget « ce mois seulement » (once).
// À partir des entrées datées existantes du groupe, du mois visé et du nouveau
// montant, renvoie la ou les écritures à poser :
//   - le nouveau montant à `month` ;
//   - la restauration du montant sous-jacent réel à `month+1`, UNIQUEMENT s'il
//     n'existe pas déjà une entrée datée exactement à `month+1`.
// Le montant sous-jacent réel est calculé en IGNORANT toute entrée datée dont
// effectiveMonth === month : réappliquer « once » sur le même mois ne restaure donc
// jamais la valeur ponctuelle précédente (qui corromprait le mois suivant), mais bien
// la valeur de base sous-jacente. Ne jamais écraser une entrée future légitime à month+1.
// Il n'y a plus de « montant de base » vers lequel retomber : sans entrée antérieure
// à `month`, la valeur sous-jacente restaurée à `month+1` est 0, comme partout ailleurs.
export function onceBudgetWrites(
  datedForGroup: { effectiveMonth: string; amount: number }[],
  month: string,
  amount: number,
): { writes: { effectiveMonth: string; amount: number }[] } {
  const next = nextMonthKey(month);
  // Valeur en vigueur à `month`, en ignorant une éventuelle entrée déjà posée
  // exactement à `month` (la précédente application « ce mois seulement »).
  let prev = 0;
  for (const b of datedForGroup) if (b.effectiveMonth !== month && b.effectiveMonth <= month) prev = b.amount;
  const writes = [{ effectiveMonth: month, amount }];
  // On ne restaure `prev` à month+1 que si aucun changement futur légitime n'y est déjà posé.
  if (!datedForGroup.some((b) => b.effectiveMonth === next)) writes.push({ effectiveMonth: next, amount: prev });
  return { writes };
}

// Regroupe les lignes du repository par groupe, en conservant le tri par mois.
export function toDatedBudgets(rows: { groupId: number; effectiveMonth: string; amount: number }[]): DatedBudgets {
  const out: DatedBudgets = {};
  for (const r of rows) (out[r.groupId] ??= []).push({ effectiveMonth: r.effectiveMonth, amount: r.amount });
  return out;
}

// Regroupe les montants de lignes par ligne, en conservant le tri par mois.
export function toDatedLineAmounts(
  rows: { lineId: number; effectiveMonth: string; amount: number }[],
): DatedLineAmounts {
  const out: DatedLineAmounts = {};
  for (const r of rows) (out[r.lineId] ??= []).push({ effectiveMonth: r.effectiveMonth, amount: r.amount });
  return out;
}
