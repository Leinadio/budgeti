export type Direction = "in" | "out";

export type OwnableGroup = {
  id: number;
  accountId: string;
  direction: Direction;
};

export type OwnedTxn = {
  id: string;
  date: string;
  amount: number;
  label: string;
  accountId: string;
  groupId: number | null;
  excluded?: boolean;
};

export type Ownership =
  | { status: "manual"; groupId: number }
  | { status: "none" };

// Rattachement 100 % manuel : une transaction appartient à un groupe seulement
// si son group_id pointe un groupe du même compte. Plus aucune correspondance
// automatique par mot-clé.
export function resolveOwnership(txn: OwnedTxn, groups: OwnableGroup[]): Ownership {
  if (txn.excluded) return { status: "none" };
  if (txn.groupId !== null) {
    const g = groups.find((x) => x.id === txn.groupId && x.accountId === txn.accountId);
    if (g) return { status: "manual", groupId: g.id };
  }
  return { status: "none" };
}

// Une dépense découpée en sous-postes n'est pas une destination : ses transactions
// appartiennent à un de ses sous-postes (Direct Assurance, Sosh Internet…), jamais au
// groupe lui-même. Une dépense plate, elle, se rattache directement.
//
// Ce n'est pas une préférence d'affichage mais l'invariant qui tient le dépassement
// d'une dépense découpée : son budget est la somme de ses sous-postes, donc une
// transaction posée sur le groupe le ferait déborder sans venir d'aucun sous-poste — et
// ce dépassement n'aurait nulle part où se lire.
//
// La question porte sur un fait (a-t-il des sous-postes ?) et non sur une nature
// déclarée : « enveloppe » et « récurrent » promettaient deux comportements et n'en
// donnaient qu'un, et n'importe quelle dépense peut désormais se découper.
export function canAttachToGroup(hasLines: boolean, lineId: number | null): boolean {
  return !hasLines || lineId !== null;
}
