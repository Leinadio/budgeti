import type Database from "better-sqlite3";
import type { BudgetScope } from "../../lib/budget-in-force";

// Un montant daté d'un groupe, avec sa portée : « ongoing » vaut à partir de son mois
// et pour les suivants, « once » ne vaut que pour son mois (voir amountInForce).
export type BudgetAmount = { groupId: number; effectiveMonth: string; amount: number; scope: BudgetScope };

// Tri : par mois, puis la règle (« ongoing ») avant l'exception (« once ») — c'est
// l'ordre de lecture de la frise, et celui qu'attend amountInForce pour balayer les
// montants permanents. Un ORDER BY scope simple mettrait « once » d'abord (alphabétique).
export function listBudgetAmounts(db: Database.Database): BudgetAmount[] {
  return (
    db
      .prepare(`SELECT group_id AS groupId, effective_month AS effectiveMonth, amount, scope FROM budget_amounts ORDER BY group_id, effective_month, CASE scope WHEN 'ongoing' THEN 0 ELSE 1 END`)
      .all() as BudgetAmount[]
  );
}

// L'unicité porte sur (groupe, mois, portée) : réécrire la même portée au même mois
// remplace le montant, mais poser une exception ne touche pas au montant permanent qui
// commence ce mois-là, et réciproquement.
export function setBudgetAmount(
  db: Database.Database, groupId: number, effectiveMonth: string, amount: number, scope: BudgetScope = "ongoing",
): void {
  db.prepare(
    `INSERT INTO budget_amounts (group_id, effective_month, amount, scope) VALUES (?, ?, ?, ?)
     ON CONFLICT(group_id, effective_month, scope) DO UPDATE SET amount = excluded.amount`,
  ).run(groupId, effectiveMonth, amount, scope);
}

// Retire une entrée datée (ex. annulation d'une hausse « permanent » d'un dépassement).
// Vise une portée précise : retirer l'exception de juillet ne doit pas emporter le
// montant permanent qui commence le même mois.
export function deleteBudgetAmount(
  db: Database.Database, groupId: number, effectiveMonth: string, scope: BudgetScope = "ongoing",
): void {
  db.prepare(`DELETE FROM budget_amounts WHERE group_id = ? AND effective_month = ? AND scope = ?`).run(groupId, effectiveMonth, scope);
}

// Supprime tous les montants POSTÉRIEURS à `effectiveMonth`, les deux portées comprises.
// Sert à la propagation « tous les mois suivants au même montant » : sans ça, un
// changement déjà posé plus tard reprendrait la main et la réponse ne voudrait pas dire
// ce qu'elle dit. Destructeur par construction — c'est le sens de la question posée.
export function deleteBudgetAmountsAfter(db: Database.Database, groupId: number, effectiveMonth: string): void {
  db.prepare(`DELETE FROM budget_amounts WHERE group_id = ? AND effective_month > ?`).run(groupId, effectiveMonth);
}
