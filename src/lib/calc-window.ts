// --- La fenêtre de calcul, plus large que celle qu'on affiche -----------------
//
// Toute la chaîne des soldes tient à une seule ancre : le mois courant se ferme sur le
// solde que la banque annonce aujourd'hui, et les autres mois s'en déduisent de proche
// en proche. Un mois affiché hors de portée de cette ancre n'a aucun moyen de connaître
// son argent de départ.
//
// D'où cette fenêtre : on calcule toujours de la borne affichée jusqu'au mois courant,
// même quand il est en dehors, puis on coupe ce qui dépasse à l'affichage. Sans ça,
// l'argent de départ de juillet changeait selon qu'on affichait juillet seul ou juillet
// et août — alors que juillet, lui, n'a pas bougé.
import { monthRange } from "./history";

export type CalcWindow = {
  calcFrom: string;
  calcTo: string;
  // Mois à retirer de chaque bout pour retrouver la fenêtre demandée.
  dropStart: number;
  dropEnd: number;
};

export function calcWindow(from: string, to: string, currentMonth: string): CalcWindow {
  const calcFrom = from <= currentMonth ? from : currentMonth;
  const calcTo = to >= currentMonth ? to : currentMonth;
  return {
    calcFrom,
    calcTo,
    dropStart: monthRange(calcFrom, from).length - 1,
    dropEnd: monthRange(to, calcTo).length - 1,
  };
}
