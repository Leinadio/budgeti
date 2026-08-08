import type { Group } from "./forecast";
import { aliveInMonth } from "./lifespan";

// --- Budgets datés ----------------------------------------------------------
// Un budget n'est pas un nombre : c'est une suite de montants, chacun daté du mois
// où il prend effet ET portant sa PORTÉE.
//   « ongoing » (le défaut quand rien n'est dit) : vaut à partir de son mois, et pour
//     tous les suivants, jusqu'au prochain montant permanent.
//   « once » : ne vaut que pour SON mois, et pour lui seul.
//
// C'est la portée qui remplace l'ancien bricolage : appliquer un montant « ce mois
// seulement » posait, en plus, une restauration de l'ancien montant au mois SUIVANT.
// Cette seconde écriture touchait un mois que personne n'avait demandé à changer, et
// se lisait ensuite dans la frise comme un changement qu'on n'avait jamais fait.
// Maintenant, un montant ponctuel s'écrit une fois, dans son mois, et rien ailleurs.
//
// Sans aucune entrée applicable, le montant est 0 : il n'existe PAS de montant de base
// sur lequel retomber. La reprise de données garantit une entrée au mois de départ de
// chaque groupe.
export type BudgetScope = "ongoing" | "once";
export type DatedEntry = { effectiveMonth: string; amount: number; scope?: BudgetScope };
export type DatedBudgets = Record<number, DatedEntry[]>;

// Même chose pour les lignes d'un récurrent, indexé par identifiant de ligne.
export type DatedLineAmounts = Record<number, DatedEntry[]>;

// Montant en vigueur à `month` dans une suite d'entrées datées (triée par mois
// croissant). Un montant ponctuel posé exactement à `month` l'emporte : c'est une
// exception, elle bat la règle. Sinon on prend le dernier montant permanent atteint.
// Les deux portées peuvent cohabiter au même mois (relever durablement à partir de
// juillet ET faire une exception pour juillet) : l'exception gagne juillet, le
// permanent vaut pour la suite.
export function amountInForce(entries: DatedEntry[], month: string): number {
  const exception = entries.find((e) => e.scope === "once" && e.effectiveMonth === month);
  if (exception) return exception.amount;
  let amount = 0;
  for (const e of entries) if (e.scope !== "once" && e.effectiveMonth <= month) amount = e.amount;
  return amount;
}

// Montant en vigueur d'une ligne de récurrent à `month`, 0 par défaut.
export function lineAmountInForce(lineId: number, month: string, datedLines?: DatedLineAmounts): number {
  return amountInForce(datedLines?.[lineId] ?? [], month);
}

// Vrai si une ligne a déjà au moins une entrée datée à `month` ou avant : la ligne
// « existe » à ce mois. Une ligne n'a pas de startMonth/endMonth comme un groupe —
// sa vie propre se lit uniquement dans sa suite de montants (addGroupLine pose la
// première entrée au mois de création, pas au début du groupe). Sans ça, un mois
// sans entrée (amountInForce = 0 par repli) serait indiscernable d'une ligne
// dont le montant vaut vraiment 0 ce mois-là.
export function lineStarted(lineId: number, month: string, datedLines?: DatedLineAmounts): boolean {
  return (datedLines?.[lineId] ?? []).some((b) => b.effectiveMonth <= month);
}

// Budget en vigueur d'un groupe à `month`. Un récurrent n'a pas de montant à lui :
// son budget est la somme de ses lignes telles qu'elles sont ce mois-là. Les
// entrées éventuellement posées sur un groupe récurrent sont donc ignorées.
//
// « Telles qu'elles sont » comprend leur durée de vie : une ligne finie ne compte
// plus, sinon le groupe garderait un budget pour un poste qui n'existe plus. La règle
// passe par aliveInMonth (et non isLineAlive, son homonyme de forecast.ts) pour ne pas
// refermer le cycle d'import entre ces deux modules.
export function budgetInForce(
  g: Group,
  month: string,
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): number {
  // Découpée en sous-postes : c'est leur somme qui fait le budget, et le montant
  // propre du groupe (s'il en avait un avant d'être découpé) ne compte plus. Un seul
  // endroit où le budget existe, donc jamais deux chiffres qui se contredisent.
  if (g.lines.length > 0) {
    return g.lines.reduce((s, l) => s + (aliveInMonth(l, month) ? lineAmountInForce(l.id, month, datedLines) : 0), 0);
  }
  return amountInForce(dated?.[g.id] ?? [], month);
}

// Provision (budget daté du groupe 0 = non catégorisés) en vigueur à `month`, 0 par défaut.
export function provisionInForce(dated: DatedBudgets | undefined, month: string): number {
  return amountInForce(dated?.[0] ?? [], month);
}

// Clé d'un budget dans le dictionnaire par mois ci-dessous. Le groupe 0 désigne la
// provision des non catégorisés, comme partout ailleurs.
export function budgetKey(groupId: number, month: string): string {
  return `${groupId}::${month}`;
}

// Budgets en vigueur, pour chaque groupe et chacun des mois demandés. Sert à
// pré-remplir le formulaire « Permanent » d'un dépassement : le montant proposé se
// calcule au mois DU DÉPASSEMENT, qui peut être ancien. Un simple budget par groupe
// ne suffit pas — il porterait forcément un mois unique, et proposerait un montant
// faux dès que le budget a changé entre ce mois et celui du dépassement.
// Ce dictionnaire traverse la frontière serveur/client : il doit rester sérialisable,
// d'où une table plate plutôt qu'une fonction de résolution.
export function budgetsByMonth(
  groups: Group[],
  months: string[],
  dated?: DatedBudgets,
  datedLines?: DatedLineAmounts,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const month of new Set(months)) {
    for (const g of groups) out[budgetKey(g.id, month)] = budgetInForce(g, month, dated, datedLines);
    out[budgetKey(0, month)] = provisionInForce(dated, month);
  }
  return out;
}

// Regroupe les lignes du repository par groupe, en conservant le tri par mois. La
// portée est transportée telle quelle : c'est elle qui décide, à la lecture, si un
// montant vaut pour son seul mois ou pour les suivants (voir amountInForce).
export function toDatedBudgets(
  rows: { groupId: number; effectiveMonth: string; amount: number; scope?: BudgetScope }[],
): DatedBudgets {
  const out: DatedBudgets = {};
  for (const r of rows) (out[r.groupId] ??= []).push({ effectiveMonth: r.effectiveMonth, amount: r.amount, scope: r.scope });
  return out;
}

// Regroupe les montants de lignes par ligne, en conservant le tri par mois.
export function toDatedLineAmounts(
  rows: { lineId: number; effectiveMonth: string; amount: number; scope?: BudgetScope }[],
): DatedLineAmounts {
  const out: DatedLineAmounts = {};
  for (const r of rows) (out[r.lineId] ??= []).push({ effectiveMonth: r.effectiveMonth, amount: r.amount, scope: r.scope });
  return out;
}
