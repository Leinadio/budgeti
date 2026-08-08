// --- Un tableau par mois ----------------------------------------------------
// L'Historique n'affiche plus un tableau à douze colonnes mais un tableau par
// mois, posés côte à côte. Chaque tableau a donc sa propre colonne de gauche, et
// elle n'a aucune raison d'être la même d'un mois à l'autre : une enveloppe qui
// commence en septembre n'a rien à faire dans le tableau d'août.
//
// Cette découpe retire les lignes qui ne vivent pas ce mois-là et les
// transactions des autres mois. Elle ne raccourcit PAS les tableaux de cellules :
// tout l'affichage est indexé par mois, une ligne rognée ferait lire la mauvaise
// colonne. Seule la liste des lignes change.
import type { HistorySection } from "./history";

// Une ligne dont on ne sait rien (aliveMonths trop court) reste affichée : mieux
// vaut une ligne de trop qu'un budget qui disparaît sans qu'on sache pourquoi.
const vivante = (alive: boolean[] | undefined, i: number) => alive?.[i] !== false;

// --- Les emplacements du tableau, garnis ou non -----------------------------
// computeHistory ne produit une section que si elle a quelque chose à montrer :
// pas de groupe de dépense, pas de section « enveloppe ». Or c'est l'en-tête de
// section qui porte le bouton qui crée un groupe. Un compte neuf n'avait donc
// aucun bouton, et il fallait déjà un groupe pour obtenir de quoi en créer un —
// le compte restait un tableau de transactions non catégorisées, sans issue.
//
// D'où cette liste d'EMPLACEMENTS : les deux sections structurelles ont toujours
// le leur, garni de la vraie section quand elle existe, vide sinon. Un emplacement
// vide n'affiche que son bouton d'ajout : ni total ni Balance, il n'y a rien à
// totaliser. Les non catégorisés n'en ont pas — on ne les crée pas, ils arrivent.
export type SectionSlot =
  | { kind: "section"; section: HistorySection }
  | { kind: "empty"; sectionKind: "income" | "expense" };

// L'ordre du tableau, celui que computeHistory produit : rémunérations, reçus non
// catégorisés, dépenses, dépenses non catégorisées.
const RANGS = ["income", "uncategorized-in", "expense", "uncategorized-out"] as const;

const rangDe = (sec: HistorySection): string =>
  sec.kind === "uncategorized" ? `uncategorized-${sec.uncatDirection ?? "out"}` : sec.kind;

export function sectionSlots(sections: HistorySection[]): SectionSlot[] {
  const slots: SectionSlot[] = [];
  for (const rang of RANGS) {
    const sec = sections.find((s) => rangDe(s) === rang);
    if (sec) slots.push({ kind: "section", section: sec });
    else if (rang !== "uncategorized-in" && rang !== "uncategorized-out") {
      slots.push({ kind: "empty", sectionKind: rang });
    }
  }
  // Une section d'un rang inconnu ne disparaît pas en silence : elle passe en queue.
  for (const sec of sections) {
    if (!RANGS.some((r) => r === rangDe(sec))) slots.push({ kind: "section", section: sec });
  }
  return slots;
}

export function sectionsAtMonth(sections: HistorySection[], i: number, month: string): HistorySection[] {
  return sections.map((sec) => ({
    ...sec,
    rows: sec.rows
      .filter((r) => vivante(r.aliveMonths, i))
      .map((r) => ({
        ...r,
        subRows: r.subRows
          .filter((s) => vivante(s.aliveMonths, i))
          .map((s) => ({ ...s, txns: s.txns.filter((t) => t.month === month) })),
        txns: r.txns.filter((t) => t.month === month),
      })),
    txns: sec.txns?.filter((t) => t.month === month),
  }));
}
