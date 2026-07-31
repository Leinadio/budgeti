export type Direction = "in" | "out";

export type OwnableGroup = {
  id: number;
  accountId: string;
  direction: Direction;
  kind: "envelope" | "recurring";
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

// Un récurrent n'est pas une destination : ses dépenses appartiennent à une de ses
// lignes (Direct Assurance, Sosh Internet…), jamais au groupe lui-même. Une enveloppe,
// qui n'a pas de lignes, se rattache directement.
//
// Ce n'est pas une préférence d'affichage mais l'invariant qui tient le dépassement
// d'un récurrent : son budget est la somme de ses lignes, donc une dépense posée sur le
// groupe le ferait déborder sans venir d'aucune ligne — et ce dépassement n'aurait
// nulle part où se trancher, puisque les décisions se prennent sur les lignes.
export function canAttachToGroup(kind: "envelope" | "recurring", lineId: number | null): boolean {
  return kind === "envelope" || lineId !== null;
}
