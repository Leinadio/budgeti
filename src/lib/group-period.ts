// --- La durée de vie d'un groupe -------------------------------------------
// Un groupe de dépense ne vit pas forcément pour toujours. Trois façons de dire
// jusqu'à quand, telles que le formulaire de création les propose :
//
//   single  un seul mois       — une dépense qui ne revient pas (des vacances)
//   range   de tel à tel mois  — une dépense qui s'arrête (un crédit, un stage)
//   from    à partir de tel mois, sans fin — le cas courant (les courses)
//
// La traduction en bornes de base (start_month / end_month, où null veut dire
// « sans fin ») vit ici et pas dans le formulaire : c'est une règle, elle se teste.
import { isMonthKey } from "./history";

export type PeriodMode = "single" | "range" | "from";

// Rend les deux bornes à écrire, ou null si la période demandée ne décrit aucun
// mois vécu — au formulaire de le dire, plutôt qu'à cette fonction de réparer en
// silence une saisie que personne n'a voulue.
export function groupPeriod(
  mode: PeriodMode,
  startMonth: string,
  endMonth?: string,
): { startMonth: string; endMonth: string | null } | null {
  if (!isMonthKey(startMonth)) return null;
  if (mode === "from") return { startMonth, endMonth: null };
  // Un seul mois commence et finit au même endroit. Un mois de fin resté d'un autre
  // choix est ignoré : le formulaire garde ses champs montés d'un mode à l'autre.
  if (mode === "single") return { startMonth, endMonth: startMonth };
  if (!isMonthKey(endMonth) || endMonth < startMonth) return null;
  return { startMonth, endMonth };
}
