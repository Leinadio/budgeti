"use server";
import { db } from "../../db/index";
import { setOverspendDecision } from "../../db/repositories/overspend-decisions";
import { setBudgetAmount } from "../../db/repositories/budget-amounts";
import { insertEnvelopeGroup, insertRecurringGroup } from "../../db/repositories/groups";
import { monthKey } from "../../lib/money";
import { addMonthsKey } from "../../lib/history";
import { revalidatePath } from "next/cache";

// Enregistre la décision de l'utilisateur sur un dépassement (groupId 0 = non
// catégorisés). « permanent » relève aussi le budget du groupe, effectif au mois
// SUIVANT le mois courant : le mois courant et les mois passés gardent leur budget
// (et donc leur dépassement réel visible dans l'historique) ; seule la projection
// des mois à venir intègre le nouveau budget.
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
    const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
    setBudgetAmount(database, groupId, addMonthsKey(currentMonth, 1), newBudget);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}

// Création inline d'un groupe (enveloppe ou récurrent) depuis le tableau de
// l'Historique. Toujours en dépense (« out ») et sans rémunération associée ;
// la durée de vie fixe la portée : « ce mois seulement » (endMonth = startMonth)
// ou permanente (endMonth = null).
export async function createGroup(input: {
  accountId: string;
  kind: "envelope" | "recurring";
  name: string;
  amount: number | null;
  startMonth: string;
  scope: "once" | "ongoing";
}): Promise<void> {
  const { accountId, kind, name, amount, startMonth, scope } = input;
  if (!/^\d{4}-\d{2}$/.test(startMonth)) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  const endMonth = scope === "once" ? startMonth : null;
  const database = db();
  if (kind === "envelope") {
    insertEnvelopeGroup(database, accountId, trimmed, "out", amount ?? 0, null, startMonth, endMonth);
  } else {
    insertRecurringGroup(database, accountId, trimmed, "out", null, startMonth, endMonth);
  }
  revalidatePath("/historique");
  revalidatePath("/previsionnel");
  revalidatePath("/");
}
