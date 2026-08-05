// --- Dire la durée de vie d'un groupe ---------------------------------------
// Dans la colonne de gauche du tableau, à côté du nom : ce groupe vaut-il pour ce
// seul mois, pour toujours, ou d'un mois à un autre ? Sans cette mention, une
// enveloppe de vacances et une enveloppe de courses se ressemblent trait pour
// trait, et rien ne dit pourquoi l'une disparaît le mois suivant.
//
// Les trois cas sont ceux du formulaire de création (cf. group-period.ts) : un
// seul mois, sans fin, ou une plage.

const MOIS = new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "UTC" });

function nomDuMois(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return MOIS.format(new Date(Date.UTC(y, mo - 1, 1)));
}

const annee = (m: string) => m.slice(0, 4);

export function groupPeriodLabel(startMonth?: string | null, endMonth?: string | null): string {
  // Pas de fin : le groupe court tant qu'on ne l'arrête pas. Son mois de départ
  // n'est pas dit — il est souvent très ancien (groupes hérités, ancrés en 2000-01)
  // et ne renseignerait sur rien.
  if (!endMonth) return "permanent";
  if (!startMonth) return `jusqu'à ${nomDuMois(endMonth)} ${annee(endMonth)}`;
  // Un seul mois : inutile de le nommer, on le lit en haut du tableau où il vit.
  if (startMonth === endMonth) return "ce mois uniquement";
  // Dans la même année, l'année ne se dit qu'une fois : la colonne est étroite.
  if (annee(startMonth) === annee(endMonth)) {
    return `de ${nomDuMois(startMonth)} à ${nomDuMois(endMonth)} ${annee(endMonth)}`;
  }
  return `de ${nomDuMois(startMonth)} ${annee(startMonth)} à ${nomDuMois(endMonth)} ${annee(endMonth)}`;
}
