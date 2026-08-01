// --- Le mois courant --------------------------------------------------------
// Où en est-on dans le calendrier : la question se pose partout, pour teinter les
// colonnes, arrêter le réel et commencer les projections. Elle se répond ici et
// nulle part ailleurs, écran comme actions serveur — deux lectures différentes
// feraient diverger le tableau de ce que le serveur calcule.
//
// Ce mois ne verrouille rien : un mois écoulé s'édite comme les autres, on y
// corrige un budget après coup. Il ne fait que dire où se trouve la frontière
// entre ce qui a été vécu et ce qui est encore prévu.

// Le fuseau où vit l'utilisateur. Fixé en dur et non lu sur la machine : le
// serveur Vercel tourne en UTC, et l'app suit un budget vécu à Paris — c'est
// l'heure de Paris qui dit quel mois on est en train de dépenser.
const TZ = "Europe/Paris";

const MONTH_AT_PARIS = new Intl.DateTimeFormat("fr-FR", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
});

// Mois courant d'une horloge, à l'heure de Paris. C'est la seule source du mois
// courant dans l'app, écran comme actions serveur : deux lectures différentes
// placeraient la frontière du réel à deux endroits, et le tableau ne dirait plus
// la même chose que ce que le serveur calcule.
//
// Surtout, ne pas repasser par toISOString() : entre minuit à Paris et minuit
// UTC, l'UTC est encore la veille — le 1er août à 1h du matin, l'app affichait
// juillet comme mois courant.
export function currentMonthKey(now: Date): string {
  const parts = MONTH_AT_PARIS.formatToParts(now);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}
