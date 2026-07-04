export function parseAmount(raw: string, creditDebit: "CRDT" | "DBIT"): number {
  const n = Number.parseFloat(raw);
  return creditDebit === "DBIT" ? -Math.abs(n) : Math.abs(n);
}

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

export function formatEur(n: number): string {
  // Intl uses narrow no-break space (U+202F) and no-break space (U+00A0); normalize to regular space.
  return EUR.format(n).replace(/[  ]/g, " ");
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
