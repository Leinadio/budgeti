// --- La forme du menu de rattachement d'une transaction ---------------------
// Le menu mélangeait deux natures de destination sans le dire : une enveloppe se
// choisit elle-même, un récurrent ne se choisit jamais (seules ses lignes comptent).
// On les sépare donc en deux sections nommées, dans l'ordre du tableau de
// l'historique — récurrents puis enveloppes — pour qu'on lise la même chose des
// deux côtés, et on indente ce qui appartient à une section.
export type GroupLike = {
  id: number;
  name: string;
  kind: "envelope" | "recurring";
  lines: { id: number; name: string }[];
};

// Un groupe (choisissable ou simple titre) ou une de ses lignes. Le composant
// décide du dessin ; ici on ne dit que ce qui va où, et ce qui se clique.
export type ChoiceItem =
  | { type: "group"; id: number; name: string; selectable: boolean }
  | { type: "line"; id: number; name: string };

export type ChoiceSection = { label: string; items: ChoiceItem[] };

// Un récurrent reste affiché même sans ligne : son titre explique pourquoi rien
// n'est choisissable dessous, là où le retirer laisserait croire qu'il n'existe pas.
function itemsOf(g: GroupLike): ChoiceItem[] {
  const groupe: ChoiceItem = {
    type: "group",
    id: g.id,
    name: g.name,
    selectable: g.kind === "envelope",
  };
  return [groupe, ...g.lines.map((l): ChoiceItem => ({ type: "line", id: l.id, name: l.name }))];
}

export function groupSelectSections(groups: GroupLike[]): ChoiceSection[] {
  const section = (label: string, kind: GroupLike["kind"]): ChoiceSection | null => {
    const dedans = groups.filter((g) => g.kind === kind);
    return dedans.length === 0 ? null : { label, items: dedans.flatMap(itemsOf) };
  };
  return [section("Récurrents", "recurring"), section("Enveloppes", "envelope")].filter(
    (s): s is ChoiceSection => s !== null,
  );
}
