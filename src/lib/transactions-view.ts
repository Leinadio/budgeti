export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const s = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
  return s.charAt(0).toUpperCase() + s.slice(1);
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
