// --- Un calendrier réduit aux mois -----------------------------------------
// Ici on ne choisit jamais un jour : un budget vit par mois entier. La grille
// est donc une année de douze cases, avec des flèches pour changer d'année.
// Les mois hors des bornes proposées restent visibles mais inertes : voir que
// mars existe et qu'on ne peut pas le prendre en dit plus que ne pas le montrer.

export type MonthCellOption = { month: string; disabled: boolean };

// L'année d'une clé 'YYYY-MM'.
export function yearOf(month: string): number {
  return Number(month.slice(0, 4));
}

// Les douze mois d'une année, dans l'ordre. Les bornes sont incluses : le mois
// du minimum se choisit, sinon on ne pourrait pas créer un groupe ce mois-ci.
export function monthsOfYear(year: number, min: string, max: string): MonthCellOption[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { month, disabled: month < min || month > max };
  });
}

// Une année où rien ne se choisit n'a pas à être atteignable : c'est ce qui
// arrête les flèches plutôt qu'une soustraction faite au jugé.
export function yearHasMonth(year: number, min: string, max: string): boolean {
  return monthsOfYear(year, min, max).some((c) => !c.disabled);
}
