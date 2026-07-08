export type Direction = "in" | "out";

export type OwnableGroup = {
  id: number;
  accountId: string;
  direction: Direction;
  kind: "envelope" | "recurring";
  keywords: string[];
};

export type OwnedTxn = {
  id: string;
  date: string;
  amount: number;
  label: string;
  accountId: string;
  groupId: number | null;
};

export type Ownership =
  | { status: "manual"; groupId: number }
  | { status: "auto"; groupId: number }
  | { status: "ambiguous" }
  | { status: "none" };

export function resolveOwnership(txn: OwnedTxn, groups: OwnableGroup[]): Ownership {
  if (txn.groupId !== null) {
    const g = groups.find((x) => x.id === txn.groupId && x.accountId === txn.accountId);
    if (g) return { status: "manual", groupId: g.id };
  }
  const label = txn.label.toLowerCase();
  const matches = groups.filter((g) => {
    if (g.accountId !== txn.accountId) return false;
    const signOk = g.direction === "out" ? txn.amount < 0 : txn.amount > 0;
    if (!signOk) return false;
    return g.keywords.some((k) => label.includes(k.toLowerCase()));
  });
  if (matches.length === 1) return { status: "auto", groupId: matches[0].id };
  if (matches.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}
