// Ce qu'annonce le bouton de rafraîchissement une fois la synchronisation faite.
// C'est la seule chose que l'utilisateur lit du résultat, d'où le soin : « 0
// transactions importées » se lirait comme une panne alors que c'est un succès — la
// banque n'avait simplement rien de neuf, ce qui est le cas le plus fréquent quand on
// rafraîchit deux fois dans la journée.
export function syncMessage(imported: number): string {
  if (!Number.isFinite(imported) || imported < 1) return "Aucune nouvelle transaction";
  return imported === 1 ? "1 transaction importée" : `${imported} transactions importées`;
}
