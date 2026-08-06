// --- Changer la durée de vie après coup -------------------------------------
// Créer un groupe, c'est facile : rien n'existe encore. Le modifier, c'est autre
// chose — des mois sont déjà remplis. D'où une seule question, posée ici : ce
// changement RETIRE-T-IL des mois de la vie du groupe, et lesquels ?
//
// Rallonger (remonter le début, repousser ou retirer la fin) n'enlève rien : le
// groupe réapparaît dans des mois d'où il avait disparu, avec le budget qu'il y
// avait déjà. Rien n'est détruit, et le geste inverse ramène tout.
//
// Raccourcir, si : les mois qui sortent perdent le budget du groupe, et leurs
// transactions repassent en non catégorisés (elles restent rattachées en base, mais
// aucun calcul ne les compte plus sous un groupe qui ne vit pas ce mois-là). C'est
// réversible aussi, mais ça change des chiffres déjà lus : ça s'annonce avant.
import { aliveInMonth, type Lifespan } from "./lifespan";

export type Period = Lifespan;

// Les mois qui étaient dans la vie et n'y sont plus. `months` est l'univers regardé :
// à l'appelant de le borner (la frise du compte jusqu'au mois courant), sinon une fin
// retirée à un groupe permanent en rendrait une infinité.
export function droppedMonths(before: Period, after: Period, months: string[]): string[] {
  return months.filter((m) => aliveInMonth(before, m) && !aliveInMonth(after, m));
}

// L'inverse : les mois gagnés. Sert à savoir s'il faut demander un montant pour eux,
// puisqu'un mois où le groupe n'a jamais vécu n'a aucun montant daté à lui.
export function addedMonths(before: Period, after: Period, months: string[]): string[] {
  return droppedMonths(after, before, months);
}

// Faut-il avertir ? Uniquement si un mois sort. Un changement qui touche aux deux
// dates sans rien retirer passe sans rien demander.
export function isShrink(before: Period, after: Period, months: string[]): boolean {
  return droppedMonths(before, after, months).length > 0;
}

// Combien de transactions basculent : celles des mois perdus. `txnMonths` porte un
// élément par transaction (doublons compris) — c'est un décompte, pas un ensemble.
export function countTxnsIn(dropped: string[], txnMonths: string[]): number {
  const perdus = new Set(dropped);
  return txnMonths.filter((m) => perdus.has(m)).length;
}
