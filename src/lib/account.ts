// Solde d'un compte tel que l'app doit le voir : celui de la banque, moins ce qui
// a été mis hors calcul. Une transaction non comptabilisée doit se comporter comme
// si elle n'existait pas ; or la banque, elle, l'a bien encaissée et son solde la
// contient. La laisser dans le solde reviendrait à la réintroduire par la bande dans
// tout ce qui s'ancre dessus : soldes reconstruits, estimation de fin de mois,
// prévisionnel, carte de compte du tableau de bord.
export function effectiveBalance(balance: number, ignoredTotal: number | undefined): number {
  return balance - (ignoredTotal ?? 0);
}

export function accountDisplayName(a: { name: string; custom_name: string | null }): string {
  return a.custom_name && a.custom_name.trim() !== "" ? a.custom_name : a.name;
}

export function accountLabel(a: {
  name: string;
  custom_name: string | null;
  iban_masked: string | null;
}): string {
  const base = accountDisplayName(a);
  return a.iban_masked ? `${base} ${a.iban_masked}` : base;
}
