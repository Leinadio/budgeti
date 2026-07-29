export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const s = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// monthLabel capitalise pour un usage en tête de ligne / titre (entête de
// colonne, subtitle d'un détail) : « Août 2026 ». Cette majuscule détonne dès
// que le mois est inséré au milieu d'une phrase française (« en Août 2026 » au
// lieu de « en août 2026 ») — monthPhrase rend la même chose en minuscule, pour
// ce cas-là.
export function monthPhrase(ym: string): string {
  const s = monthLabel(ym);
  return s.charAt(0).toLowerCase() + s.slice(1);
}

// Mois français commençant par une voyelle (donc par élision de « de ») : avril,
// août, octobre. Les 9 autres commencent par une consonne (mars, mai, juin,
// juillet, septembre, novembre, décembre, janvier, février) : pas d'élision.
const VOWEL_START = /^[aeiouyàâäéèêëïîôöùûü]/i;

// « de »/« d' » + le mois en minuscule, pour un « à partir de <mois> » ou
// équivalent au milieu d'une phrase : élide en « d' » devant les 3 mois qui
// commencent par une voyelle (avril, août, octobre), garde « de » pour les
// 9 autres. Rend la préposition ET le mois ensemble — rien à concaténer côté
// appelant, pour ne pas laisser un « de » ou une majuscule s'y réintroduire.
export function deMonthPhrase(ym: string): string {
  const phrase = monthPhrase(ym);
  return (VOWEL_START.test(phrase) ? "d'" : "de ") + phrase;
}

export function groupByMonth<T extends { date: string }>(
  items: T[],
): { month: string; label: string; items: T[] }[] {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = it.date.slice(0, 7);
    const arr = map.get(key);
    if (arr) arr.push(it);
    else map.set(key, [it]);
  }
  return [...map.entries()].map(([month, monthItems]) => ({
    month,
    label: monthLabel(month),
    items: monthItems,
  }));
}
