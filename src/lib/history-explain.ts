// Détail d'un calcul affiché dans la sidebar de l'Historique, sous forme d'arbre :
// des nœuds signés (Σ = result) dont certains sont dépliables (children), jusqu'aux
// transactions. Le signe pilote l'opérateur affiché (+ / −).
export type DetailNode = { label: string; amount: number; children?: DetailNode[] };
export type CellDetail = { title: string; subtitle?: string; nodes: DetailNode[]; result: number; note?: string };

export function sumOf(nodes: DetailNode[]): number {
  return nodes.reduce((s, n) => s + n.amount, 0);
}

export function makeDetail(
  title: string,
  nodes: DetailNode[],
  opts?: { subtitle?: string; note?: string; result?: number },
): CellDetail {
  return {
    title,
    subtitle: opts?.subtitle,
    nodes,
    result: opts?.result ?? sumOf(nodes),
    note: opts?.note,
  };
}

// Feuille = une transaction : « date · libellé », montant signé.
export function txnNode(date: string, label: string, signedAmount: number): DetailNode {
  return { label: `${date} · ${label}`, amount: signedAmount };
}
