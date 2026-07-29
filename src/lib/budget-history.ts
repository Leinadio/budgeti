// Un montant dans la vie d'un budget : le mois où il prend effet, sa valeur, et
// s'il s'agit du montant de départ (la première entrée, qui ne se supprime pas).
export type BudgetChange = { month: string; amount: number; isStart: boolean };

// Liste lisible des montants d'un budget, triée par mois croissant. Les entrées
// qui répètent le montant déjà en vigueur sont masquées : elles n'apprennent rien
// et encombreraient le panneau (une application « ce mois seulement » en pose une
// au mois suivant, qui restaure la valeur précédente).
export function budgetChanges(entries: { effectiveMonth: string; amount: number }[]): BudgetChange[] {
  const triees = [...entries].sort((a, b) => (a.effectiveMonth < b.effectiveMonth ? -1 : 1));
  const out: BudgetChange[] = [];
  let courant: number | null = null;
  for (const e of triees) {
    if (courant !== null && Math.abs(e.amount - courant) < 0.005) continue;
    out.push({ month: e.effectiveMonth, amount: e.amount, isStart: out.length === 0 });
    courant = e.amount;
  }
  return out;
}

// Montant en vigueur à `month` dans une liste de changements déjà triée (celle
// que rend budgetChanges) : la dernière entrée dont le mois est atteint, 0 sinon.
// Distincte de amountAt (overspend-writes.ts), qui répond « exactement à ce
// mois, sinon rien » — ne pas confondre les deux.
export function amountAtMonth(changes: BudgetChange[], month: string): number {
  let amount = 0;
  for (const c of changes) if (c.month <= month) amount = c.amount;
  return amount;
}

// Une entrée ne se supprime que s'il en existe une antérieure pour prendre le
// relais. Sinon `month` est (au moins à égalité) la plus ancienne entrée du
// groupe — le montant de départ, ou ce qui en tient lieu — et la retirer
// laisserait sans budget tous les mois qui la précédaient, jusqu'au prochain
// changement s'il y en a un, ou le groupe entier s'il n'y en a pas. La règle
// porte sur la donnée telle qu'elle est en base (les `entries` passées ici),
// jamais sur un `isStart` calculé côté client : c'est justement ce qui manquait
// — l'affichage cachait la corbeille sur le montant de départ, mais rien
// n'empêchait d'appeler l'action serveur directement avec ce mois-là.
export function canRemoveBudgetChange(entries: { effectiveMonth: string }[], month: string): boolean {
  return entries.some((e) => e.effectiveMonth < month);
}
