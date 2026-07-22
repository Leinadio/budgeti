// Colonne d'une case du tableau. Colonnes réelles (mois passés / courant) plus les
// colonnes de projection (mois courant / futurs) : revenus, dépassement, solde prévu
// et solde si dépassement.
export type Col =
  | "budget" | "depense" | "recu" | "reste" | "solde"
  | "revenus" | "depassement" | "soldePrevu" | "soldeDepass";

// Identité d'une ligne du tableau, sous forme de préfixe de clé. Sert à composer
// une clé de case (avec la colonne et le mois) et, pour une transaction, à
// retrouver la ligne à révéler.
export const openingRow = "opening";
export const sectionRow = (kind: string) => `section:${kind}`;
export const groupRow = (id: number) => `group:${id}`;
export const subRow = (id: number) => `subrow:${id}`;
export const txnRow = (id: string) => `txn:${id}`;

// Clé d'une case du tableau : ligne + colonne + index de mois. Sert de comparateur
// de surbrillance et d'attribut data-cellkey sur la case (repérage pour le
// défilement). Un nœud du détail porte la clé de la case qui affiche son montant.
export function cellKey(row: string, col: Col, month: number): string {
  return `${row}::${col}::${month}`;
}

// Détail d'un calcul affiché dans la sidebar de l'Historique, sous forme d'arbre :
// des nœuds signés (Σ = result) dont certains sont dépliables (children), jusqu'aux
// transactions. Le signe pilote l'opérateur affiché (+ / −). ref (optionnel) est la
// clé de la case du tableau qui affiche ce montant, pour la surbrillance croisée.
// refs (optionnel) : plusieurs cases à surligner ensemble, quand le montant est une
// somme qui n'apparaît nulle part telle quelle (il prime sur ref).
export type DetailNode = { label: string; amount: number; children?: DetailNode[]; ref?: string; refs?: string[] };
// cellRef : clé de la case du tableau qui a ouvert ce détail (son résultat). Permet
// de surligner cette case en cliquant la ligne « Total » du side panel.
// description : si présent, le détail est une explication de colonne (texte, un
// paragraphe par entrée) et non un calcul — le panneau l'affiche alors tel quel.
// overspendAction : présent quand le détail vient d'une Balance en dépassement d'un
// mois passé ou courant. Pilote le bloc de décision affiché sous le tableau du
// détail dans le side panel (voir OverspendActionBlock).
// groupManage : présent quand le détail vient du menu de gestion d'une ligne de
// groupe (icône au survol). Pilote la vue de gestion du side panel (renommer,
// montant daté, lignes, suppression) au lieu d'un calcul (voir GroupManageBlock).
export type CellDetail = { title: string; subtitle?: string; nodes: DetailNode[]; result: number; note?: string; cellRef?: string; description?: string[]; overspendAction?: OverspendActionInfo; groupManage?: GroupManageInfo };

// Info nécessaire à la vue de gestion d'un groupe dans le side panel : quel groupe,
// son nom, sa nature (enveloppe = un montant unique / récurrent = des lignes), le
// mois sélectionné (pour le montant daté), le budget en vigueur ce mois-là (pré-
// remplissage) et, pour un récurrent, ses lignes.
export type GroupManageInfo = {
  groupId: number;
  name: string;
  kind: "envelope" | "recurring";
  month: string;          // mois affiché sélectionné (pour le montant daté)
  currentAmount: number;  // budget en vigueur ce mois (pré-remplissage)
  lines: { id: number; name: string; amount: number; day: number }[];
};

// Info nécessaire au bloc de décision d'un dépassement de budget : quel groupe (0 =
// non catégorisés), quel mois, de combien, et la décision déjà prise le cas échéant.
export type OverspendActionInfo = {
  accountId: string;
  groupId: number; // 0 = non catégorisés
  groupName: string;
  month: string; // YYYY-MM
  amount: number; // dépassement, positif
  decision: "exceptional" | "permanent" | null; // null = non tranché
  currentBudget: number | null; // budget/provision actuel, pour pré-remplir « permanent »
};

export function sumOf(nodes: DetailNode[]): number {
  return nodes.reduce((s, n) => s + n.amount, 0);
}

// Détail « explication de colonne » : titre (nom de la colonne) + paragraphes de
// texte, sans calcul. Affiché tel quel dans le side panel.
export function makeInfo(title: string, description: string[]): CellDetail {
  return { title, nodes: [], result: 0, description };
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

// Feuille = une transaction : « date · libellé », montant signé. ref (optionnel) =
// clé de la case du tableau qui affiche cette transaction.
export function txnNode(date: string, label: string, signedAmount: number, ref?: string): DetailNode {
  return { label: `${date} · ${label}`, amount: signedAmount, ref };
}
