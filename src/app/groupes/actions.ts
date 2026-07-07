"use server";
import { db } from "../../db/index";
import {
  insertGroup,
  deleteGroup,
  insertLine,
  deleteLine,
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
  const name = String(formData.get("name") ?? "").trim();
  const keyword = String(formData.get("keyword") ?? "").trim();
  const amount = Number.parseFloat(String(formData.get("amount")));
  const dayRaw = String(formData.get("day") ?? "").trim();
  const dayParsed = Number.parseInt(dayRaw, 10);
  const day = dayRaw !== "" && Number.isFinite(dayParsed) ? dayParsed : null;
  if (!Number.isFinite(groupId) || !name || !keyword) return;
  insertLine(db(), groupId, name, Number.isFinite(amount) ? amount : 0, day, keyword);
  refresh();
}

export async function removeLine(formData: FormData) {
  const id = Number.parseInt(String(formData.get("id")), 10);
  if (Number.isFinite(id)) deleteLine(db(), id);
  refresh();
}
