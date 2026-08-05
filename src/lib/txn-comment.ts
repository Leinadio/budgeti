// --- Le commentaire d'une transaction ---------------------------------------
// Une note à soi, posée sous le libellé de la banque : « remboursé par Marie »,
// « à vérifier », « cadeau anniversaire ». Le libellé de la banque n'est pas
// touché — le commentaire s'ajoute, il ne remplace rien.

// Ce qu'on écrit en base à la saisie. Vider le champ, c'est retirer le
// commentaire : on écrit null (« aucun commentaire ») et non une chaîne vide, qui
// se relirait comme un commentaire, vide mais présent. Seuls les bords sont
// nettoyés : un commentaire sur plusieurs lignes garde sa forme.
export function normalizeComment(input: string): string | null {
  const trimmed = input.trim();
  return trimmed === "" ? null : trimmed;
}

// Y a-t-il quelque chose à afficher ? Sert à choisir entre montrer le commentaire
// et proposer d'en écrire un.
export function hasComment(comment?: string | null): boolean {
  return (comment ?? "").trim() !== "";
}
