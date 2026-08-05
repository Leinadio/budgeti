// --- Un tableau par mois ----------------------------------------------------
// L'Historique n'affiche plus un tableau à douze colonnes mais un tableau par
// mois, posés côte à côte. Chaque tableau a donc sa propre colonne de gauche, et
// elle n'a aucune raison d'être la même d'un mois à l'autre : une enveloppe qui
// commence en septembre n'a rien à faire dans le tableau d'août.
//
// Cette découpe retire les lignes qui ne vivent pas ce mois-là et les
// transactions des autres mois. Elle ne raccourcit PAS les tableaux de cellules :
// tout l'affichage est indexé par mois, une ligne rognée ferait lire la mauvaise
// colonne. Seule la liste des lignes change.
import type { HistorySection } from "./history";

// Une ligne dont on ne sait rien (aliveMonths trop court) reste affichée : mieux
// vaut une ligne de trop qu'un budget qui disparaît sans qu'on sache pourquoi.
const vivante = (alive: boolean[] | undefined, i: number) => alive?.[i] !== false;

export function sectionsAtMonth(sections: HistorySection[], i: number, month: string): HistorySection[] {
  return sections.map((sec) => ({
    ...sec,
    rows: sec.rows
      .filter((r) => vivante(r.aliveMonths, i))
      .map((r) => ({
        ...r,
        subRows: r.subRows
          .filter((s) => vivante(s.aliveMonths, i))
          .map((s) => ({ ...s, txns: s.txns.filter((t) => t.month === month) })),
        txns: r.txns.filter((t) => t.month === month),
      })),
    txns: sec.txns?.filter((t) => t.month === month),
  }));
}
