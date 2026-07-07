"use server";
import { db } from "../../db/index";
import {
  insertGroup,
  deleteGroup,
  insertLine,
  deleteLine,
  getGroupDirection,
} from "../../db/repositories/groups";
import { revalidatePath } from "next/cache";

function refresh() {
  revalidatePath("/groupes");
  revalidatePath("/previsionnel");
}

export async function addGroup(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const direction = String(formData.get("direction") ?? "");
  if (!accountId || !name || (direction !== "in" && direction !== "out")) return;
  insertGroup(db(), accountId, name, direction);
  refresh();
}

export async function removeGroup(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteGroup(db(), id);
  refresh();
}

export async function addLine(formData: FormData) {
  const groupId = Number.parseInt(String(formData.get("groupId")), 10);
  if (!Number.isFinite(groupId)) return;
  const name = String(formData.get("name") ?? "").trim();
  const keyword = String(formData.get("keyword") ?? "").trim();
  if (!name || !keyword) return;

  const parsed = Number.parseFloat(String(formData.get("amount")));
  const amount = Number.isFinite(parsed) ? Math.abs(parsed) : 0;

  const dayRaw = String(formData.get("day") ?? "").trim();
  let day: number | null;
  if (dayRaw === "") {
    day = null;
  } else {
    const dayParsed = Number.parseInt(dayRaw, 10);
    if (!Number.isFinite(dayParsed) || dayParsed < 1 || dayParsed > 31) return;
    day = dayParsed;
  }

  const direction = getGroupDirection(db(), groupId);
  if (direction === "in" && day === null) return;

  insertLine(db(), groupId, name, amount, day, keyword);
  refresh();
}

export async function removeLine(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteLine(db(), id);
  refresh();
}
