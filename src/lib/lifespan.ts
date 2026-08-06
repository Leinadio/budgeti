// --- Vivre entre deux mois --------------------------------------------------
// La même règle sert deux fois : pour un groupe (« cette enveloppe ne vaut que pour
// juillet ») et pour une ligne de récurrent (« cet abonnement s'arrête en mai »).
// Elle vit dans son propre module parce que ses deux consommateurs — forecast.ts et
// budget-in-force.ts — s'importent déjà l'un l'autre : la poser chez l'un fermerait
// le cycle. Ici, elle n'importe rien.
//
// Une borne à null ne borne pas de ce côté : sans aucune des deux, on vit toujours.
export type Lifespan = { startMonth?: string | null; endMonth?: string | null };

export function aliveInMonth(l: Lifespan, month: string): boolean {
  if (l.startMonth != null && month < l.startMonth) return false;
  if (l.endMonth != null && month > l.endMonth) return false;
  return true;
}
