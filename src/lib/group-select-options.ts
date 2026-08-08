// --- La forme du menu de rattachement d'une transaction ---------------------
// Le menu mélangeait des destinations de nature et de sens différents sans le dire :
// une enveloppe se choisit elle-même, un récurrent ne se choisit jamais (seules ses
// lignes comptent), et une rémunération n'est pas une dépense du tout. On les sépare
// donc en sections nommées, dans l'ordre du tableau de l'historique — rémunérations,
// récurrents, enveloppes — pour qu'on lise la même chose des deux côtés, et on
// indente ce qui appartient à une section.
//
// Le sens décide de la section, les sous-postes décident de ce qui se clique : une
// rémunération est un groupe entrant, rien ne la distingue à part sa direction.
export type GroupLike = {
  id: number;
  name: string;
  direction: "in" | "out";
  lines: { id: number; name: string }[];
};

// Un groupe (choisissable ou simple titre) ou une de ses lignes. Le composant
// décide du dessin ; ici on ne dit que ce qui va où, et ce qui se clique.
export type ChoiceItem =
  | { type: "group"; id: number; name: string; selectable: boolean }
  | { type: "line"; id: number; name: string };

export type ChoiceSection = { label: string; items: ChoiceItem[] };

// Une dépense découpée reste affichée même si on ne peut pas la viser elle-même : son
// titre explique pourquoi ce sont ses sous-postes qu'on choisit dessous, là où la
// retirer laisserait croire qu'elle n'existe pas.
function itemsOf(g: GroupLike): ChoiceItem[] {
  const groupe: ChoiceItem = {
    type: "group",
    id: g.id,
    name: g.name,
    // Ce qui décide, c'est le fait d'avoir des sous-postes, pas une nature déclarée :
    // une dépense découpée n'est pas une destination (voir canAttachToGroup).
    selectable: g.lines.length === 0,
  };
  return [groupe, ...g.lines.map((l): ChoiceItem => ({ type: "line", id: l.id, name: l.name }))];
}

export function groupSelectSections(groups: GroupLike[]): ChoiceSection[] {
  const section = (label: string, retient: (g: GroupLike) => boolean): ChoiceSection | null => {
    const dedans = groups.filter(retient);
    return dedans.length === 0 ? null : { label, items: dedans.flatMap(itemsOf) };
  };
  // Les entrants d'abord, quelle que soit leur nature : le tableau les met en haut,
  // et un récurrent entrant reste un revenu avant d'être un récurrent.
  return [
    section("Revenus", (g) => g.direction === "in"),
    section("Dépenses", (g) => g.direction === "out"),
  ].filter((s): s is ChoiceSection => s !== null);
}
