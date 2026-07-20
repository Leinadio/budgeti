"use server";
import { db } from "../../db/index";
import { setOverspendDecision } from "../../db/repositories/overspend-decisions";
import { setBudgetAmount } from "../../db/repositories/budget-amounts";
import { monthKey } from "../../lib/money";
import { revalidatePath } from "next/cache";

// Enregistre la décision de l'utilisateur sur un dépassement (groupId 0 = non
// catégorisés). « permanent » relève aussi le budget du groupe, effectif au mois
// courant — jamais rétroactif (les mois passés gardent l'ancien budget).
export async function decideOverspend(
  accountId: string,
  groupId: number,
  month: string,
  decision: "exceptional" | "permanent",
  newBudget?: number,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) return;
  const database = db();
  setOverspendDecision(database, { accountId, groupId, month, decision, decidedAt: new Date().toISOString() });
  if (decision === "permanent" && groupId !== 0 && newBudget != null && Number.isFinite(newBudget) && newBudget > 0) {
    setBudgetAmount(database, groupId, monthKey(new Date().toISOString().slice(0, 10)), newBudget);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
