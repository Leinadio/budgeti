// --- Ce qu'une case de solde affiche ----------------------------------------
// Les trois colonnes de solde (réel, prévu, si dépassement) se lisent de haut en bas
// comme un calcul : chaque ligne ajoute ou retranche, et la case montre où on en est.
//
// D'où quatre cas, et une règle qui mérite de vivre hors du JSX :
//
//   plain      la ligne n'opère pas (« Argent de départ », un résultat) : le montant
//              s'affiche signé, sans opérateur.
//   empty      la ligne n'a rien bougé : rien à montrer, la colonne ne garde que les
//              lignes qui opèrent.
//   operation  l'affichage habituel : l'opérateur du mouvement, puis le solde en
//              VALEUR ABSOLUE — jamais de double signe « − -39,73 ». Le montant ne
//              porte donc pas son signe, mais la case le sait (`negative`), et c'est
//              la couleur qui le dit.
//   detailed   le mode détaillé (case à cocher au-dessus du tableau) : le mouvement se
//              dit à part, entre parenthèses, et le solde reprend son signe.
//
// Le dernier cas existe pour une raison précise. En affichage habituel, une case rouge
// peut vouloir dire deux choses : « cette ligne retranche » ou « le solde est négatif ».
// Quand les deux sont vrais en même temps, rien ne les distingue, et le signe du solde
// reste invisible puisqu'il s'affiche en valeur absolue. Séparer le mouvement du solde
// rend à chacun son signe et sa couleur.
export type SoldeCell =
  | { kind: "empty" }
  | { kind: "plain"; value: number }
  | { kind: "operation"; sign: "+" | "−"; value: number; negative: boolean }
  | { kind: "detailed"; delta: number; value: number };

// Seuil du « mouvement nul », le même que partout ailleurs dans l'app : en dessous d'un
// demi-centime, deux montants sont le même montant.
const NUL = 0.005;

export function soldeCell(value: number, delta: number | null | undefined, detailed: boolean): SoldeCell {
  if (delta == null) return { kind: "plain", value };
  if (Math.abs(delta) < NUL) return { kind: "empty" };
  if (detailed) return { kind: "detailed", delta, value };
  return {
    kind: "operation",
    sign: delta > 0 ? "+" : "−",
    value: Math.abs(value),
    negative: value < -NUL,
  };
}
