import type { BudgetChange } from "./budget-history";

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
// uncatProvision : présent quand le détail vient de la case « Budget dép. » des non
// catégorisés. Pilote le bloc d'édition de la provision (montant daté du groupe 0,
// voir UncatProvisionBlock) au lieu d'un calcul.
export type CellDetail = { title: string; subtitle?: string; nodes: DetailNode[]; result: number; note?: string; cellRef?: string; description?: string[]; overspendAction?: OverspendActionInfo; groupManage?: GroupManageInfo; lineManage?: LineManageInfo; uncatProvision?: UncatProvisionInfo; budgetEdit?: BudgetEditInfo };

// Info nécessaire à la vue de gestion d'un groupe dans le side panel : quel groupe,
// son nom, sa nature (une enveloppe n'a pas de lignes, un récurrent si), le mois où le
// panneau se place (pour poser le montant de départ d'une ligne qu'on ajoute) et, pour
// un récurrent, ses lignes réduites à ce qui vaut pour tous les mois : nom et jour.
// Aucun montant existant : un montant est daté, ce panneau n'affiche aucun mois, il ne
// pourrait donc en montrer qu'un, vrai pour un seul mois — voir BudgetEditInfo.
export type GroupManageInfo = {
  groupId: number;
  name: string;
  kind: "envelope" | "recurring";
  month: string; // mois où le panneau se place (montant de départ d'une ligne ajoutée)
  lines: { id: number; name: string; day: number }[];
};

// Info nécessaire à la vue de gestion d'une ligne de récurrent, ouverte par le crayon
// au survol de la ligne. Une ligne a son propre crayon parce qu'elle est un poste à
// part entière : Sosh Internet n'est pas Sosh Mobile, et les renommer depuis le
// panneau du groupe obligeait à chercher la bonne parmi toutes les autres.
// Nom et jour seulement : ce sont ses deux propriétés qui valent pour tous les mois.
// Son montant est daté et se fixe depuis sa case du tableau (voir BudgetEditInfo) —
// même règle que pour une enveloppe, et pour la même raison.
export type LineManageInfo = {
  lineId: number;
  name: string;
  day: number;
};

// Info nécessaire au bloc d'édition d'un budget ouvert depuis sa case « Budget dép. ».
// C'est le seul endroit où un montant se modifie, parce que c'est le seul où le mois
// est sous les yeux : un budget n'est pas un nombre mais une suite de montants datés,
// et « le montant du groupe » tout court ne veut rien dire. Le panneau de gestion du
// groupe, qui ne montre aucun mois, n'en affiche donc plus aucun.
// `target` dit ce qu'on écrit : le montant d'une enveloppe, ou celui d'une ligne de
// récurrent (un récurrent n'a pas de montant à lui, sa case n'est pas modifiable).
export type BudgetEditInfo = {
  target: "group" | "line";
  id: number;              // identifiant de groupe ou de ligne selon `target`
  name: string;
  month: string;           // mois de la case cliquée : celui où le montant prendra effet
  amount: number;          // montant en vigueur ce mois-là (pré-remplissage)
  changes: BudgetChange[]; // la frise entière, affichée sous le champ
  // Mois courant, pour que le bloc sache lesquelles des entrées de la frise portent
  // encore une corbeille (removableChangeMonths). Transmis plutôt que précalculé :
  // le bloc reçoit une frise à jour après chaque application et doit la rejuger,
  // sinon une entrée tout juste posée n'aurait pas de corbeille jusqu'au prochain clic.
  currentMonth: string;
};

// Info nécessaire au bloc d'édition de la provision des non catégorisés (case
// « Budget dép. » de la section non catégorisés) : le mois de la case cliquée et la
// provision en vigueur ce mois-là (pré-remplissage).
export type UncatProvisionInfo = {
  month: string;          // mois de la case cliquée (pour le montant daté)
  currentAmount: number;  // provision en vigueur ce mois (pré-remplissage)
};

// Info nécessaire au bloc de décision d'un dépassement de budget : quel groupe (0 =
// non catégorisés), quel mois, de combien, et la décision déjà prise le cas échéant.
export type OverspendActionInfo = {
  accountId: string;
  groupId: number; // 0 = non catégorisés
  groupName: string;
  // Nature de ce qui déborde. Sert au libellé du formulaire (« Nouvelle provision »
  // pour les non catégorisés, « Budget » ailleurs) : le formulaire lui-même est le
  // même partout, un seul montant, puisqu'on tranche toujours quelque chose qui porte
  // un budget à soi.
  groupKind: "envelope" | "recurring";
  // Ligne de récurrent qui déborde, null pour une enveloppe et pour les non
  // catégorisés. C'est ce qui porte un budget qui se tranche : un récurrent n'en a pas
  // (son budget est la somme de ses lignes), son groupe n'est donc jamais décidable.
  lineId: number | null;
  month: string; // YYYY-MM
  amount: number; // dépassement, positif
  decision: "exceptional" | "permanent" | null; // null = non tranché
  currentBudget: number | null; // budget/provision actuel, pour pré-remplir « permanent »
  // Le mois du dépassement est-il clos ? Un mois révolu ne se tranche plus et ne se
  // dételle plus : le bloc n'affiche alors que ce qui s'applique (closedOverspendText
  // ci-dessous), sans bouton. Absent vaut « ouvert » : les items qui viennent de
  // computeOverspends sont par construction du mois courant, jamais clos.
  closed?: boolean;
};

// Ce que dit le bloc de décision quand le mois du dépassement est clos : il n'y a
// plus rien à trancher ni à défaire, seulement à rappeler ce qui s'applique et
// pourquoi c'est définitif. Reçoit le montant et le mois déjà mis en français par
// l'appelant (formatage des euros, élision, casse) : cette fonction porte la phrase,
// pas la mise en forme.
export function closedOverspendText(
  decision: "exceptional" | "permanent" | null,
  amountLabel: string,
  monthPhrase: string,
): string {
  const entete = `Dépassement de ${amountLabel} en ${monthPhrase}`;
  if (decision === null) {
    return `${entete}. Ce mois est terminé : il compte comme exceptionnel, et son budget ne se modifie plus.`;
  }
  const tranche = decision === "permanent" ? "permanent" : "exceptionnel";
  return `${entete}, tranché ${tranche}. Ce mois est terminé, cette décision ne se modifie plus.`;
}

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
