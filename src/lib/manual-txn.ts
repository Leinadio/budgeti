import type { ManualTxnInput } from "@/db/repositories/transactions";

export type ManualFormInput = {
  accountId: string;
  date: string; // YYYY-MM-DD
  direction: "in" | "out";
  amount: number; // positif tel que saisi
  label: string;
  groupId: number | null;
  lineId: number | null;
  incomeKind: "principal" | "supplementary" | null;
};

export function isValidManualForm(f: ManualFormInput): boolean {
  if (!f.accountId) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return false;
  if (!Number.isFinite(f.amount) || f.amount === 0) return false;
  return true;
}

// Normalise le formulaire vers l'entrée repository : signe le montant, force
// income_kind (null pour une sortie, principal par défaut pour une entrée),
// libellé par défaut si vide.
export function toManualInput(f: ManualFormInput): ManualTxnInput {
  const magnitude = Math.abs(f.amount);
  const amount = f.direction === "in" ? magnitude : -magnitude;
  const label = f.label.trim() || (f.direction === "in" ? "Entrée manuelle" : "Sortie manuelle");
  const incomeKind = f.direction === "in" ? (f.incomeKind ?? "principal") : null;
  return { accountId: f.accountId, date: f.date, amount, label, groupId: f.groupId, lineId: f.lineId, incomeKind };
}
