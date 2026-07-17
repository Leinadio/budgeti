"use server";
import { db } from "../../db/index";
import {
  insertEnvelopeGroup,
  insertRecurringGroup,
  deleteGroup,
  updateGroup,
  insertLine,
  updateLine,
  deleteLine,
  hasIncomeGroup,
} from "../../db/repositories/groups";
import { revalidatePath } from "next/cache";

function refresh() {
  revalidatePath("/groupes");
  revalidatePath("/previsionnel");
  revalidatePath("/transactions");
  revalidatePath("/");
}

const REMU_NAMES = {
  principal: "Rémunération principale",
  supplementary: "Rémunération supplémentaire",
} as const;

export async function addGroup(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "").trim();
  const nature = String(formData.get("nature") ?? "");
  if (!accountId) return;

  if (nature === "principal" || nature === "supplementary") {
    if (hasIncomeGroup(db(), accountId, nature)) return; // une seule de chaque
    const parsed = Number.parseFloat(String(formData.get("monthlyAmount")));
    const amount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
    insertEnvelopeGroup(db(), accountId, REMU_NAMES[nature], "in", amount, nature);
  } else if (nature === "expense") {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const kind = String(formData.get("kind") ?? "");
    if (kind === "envelope") {
      const parsed = Number.parseFloat(String(formData.get("monthlyAmount")));
      insertEnvelopeGroup(db(), accountId, name, "out", Number.isFinite(parsed) ? Math.abs(parsed) : 0, null);
    } else if (kind === "recurring") {
      insertRecurringGroup(db(), accountId, name, "out", null);
    } else {
      return;
    }
  } else {
    return;
  }
  refresh();
}

export async function removeGroup(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteGroup(db(), id);
  refresh();
}

export async function editGroup(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  const name = String(formData.get("name") ?? "").trim();
  const direction = String(formData.get("direction") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!Number.isFinite(id) || !name || (direction !== "in" && direction !== "out")) return;
  let monthlyAmount: number | null = null;
  if (kind === "envelope") {
    const parsed = Number.parseFloat(String(formData.get("monthlyAmount")));
    monthlyAmount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  }
  updateGroup(db(), id, name, direction, monthlyAmount);
  refresh();
}

export async function addLine(formData: FormData) {
  const groupId = Number.parseInt(String(formData.get("groupId")), 10);
  if (!Number.isFinite(groupId)) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const parsed = Number.parseFloat(String(formData.get("amount")));
  const amount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  const dayParsed = Number.parseInt(String(formData.get("day")), 10);
  if (!Number.isFinite(dayParsed) || dayParsed < 1 || dayParsed > 31) return;
  insertLine(db(), groupId, name, amount, dayParsed, "");
  refresh();
}

export async function editLine(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (!Number.isFinite(id)) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const parsed = Number.parseFloat(String(formData.get("amount")));
  const amount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;
  const dayParsed = Number.parseInt(String(formData.get("day")), 10);
  if (!Number.isFinite(dayParsed) || dayParsed < 1 || dayParsed > 31) return;
  updateLine(db(), id, name, amount, dayParsed, "");
  refresh();
}

export async function removeLine(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteLine(db(), id);
  refresh();
}
