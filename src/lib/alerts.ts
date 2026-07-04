import type { Envelope } from "./budget";
import { formatEur } from "./money";

export type Alert = { level: "warn" | "danger"; message: string };

export function buildAlerts(
  envelopes: Envelope[],
  balance: number,
  balanceThreshold: number,
): Alert[] {
  const alerts: Alert[] = [];
  for (const e of envelopes) {
    if (e.ratio >= 1) {
      alerts.push({
        level: "danger",
        message: `Budget dépassé sur ${e.category} (${formatEur(e.spent)} / ${formatEur(e.limit)}).`,
      });
    } else if (e.ratio >= 0.8) {
      alerts.push({
        level: "warn",
        message: `Attention, il te reste ${formatEur(e.remaining)} sur ${e.category}.`,
      });
    }
  }
  if (balance < balanceThreshold) {
    alerts.push({
      level: "danger",
      message: `Ton solde (${formatEur(balance)}) est passé sous ton seuil de ${formatEur(balanceThreshold)}.`,
    });
  }
  return alerts;
}
