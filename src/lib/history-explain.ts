// Détail d'un calcul affiché dans le tableau Historique : un titre, des étapes
// signées, et un total qui doit égaler le montant de la cellule cliquée.
export type ExplanationStep = { label: string; amount: number };
export type CellExplanation = { title: string; steps: ExplanationStep[]; result: number; note?: string };

const sum = (steps: ExplanationStep[]) => steps.reduce((s, e) => s + e.amount, 0);

// Reste = Budget − Dépensé.
export function resteExplanation(budgeted: number, depense: number): CellExplanation {
  const steps: ExplanationStep[] = [
    { label: "Budget", amount: budgeted },
    { label: "Dépensé", amount: -depense },
  ];
  return { title: "Reste = Budget − Dépensé", steps, result: sum(steps) };
}

// Somme d'une liste (transactions, postes d'un récurrent, groupes d'une section…).
export function sumExplanation(title: string, entries: ExplanationStep[], note?: string): CellExplanation {
  return { title, steps: entries, result: sum(entries), note };
}

// Solde cumulé = solde de la ligne précédente ± mouvement de cette ligne.
export function runningExplanation(prevSolde: number, netLine: number): CellExplanation {
  const steps: ExplanationStep[] = [
    { label: "Solde ligne précédente", amount: prevSolde },
    { label: "Mouvement de cette ligne", amount: netLine },
  ];
  return { title: "Solde cumulé", steps, result: sum(steps) };
}

// Solde = Argent de départ + Total reçu − Total dépensé.
export function soldeActuelExplanation(opening: number, recu: number, depense: number): CellExplanation {
  const steps: ExplanationStep[] = [
    { label: "Argent de départ", amount: opening },
    { label: "Total reçu", amount: recu },
    { label: "Total dépensé", amount: -depense },
  ];
  return { title: "Solde = Départ + Reçu − Dépensé", steps, result: sum(steps) };
}
