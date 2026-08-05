// --- Les groupes proposés à une transaction ---------------------------------
// Un groupe a une durée de vie (cf. isGroupAlive). Le menu de rattachement d'une
// transaction ne propose donc que les groupes qui existent LE MOIS de cette
// transaction : une enveloppe créée pour le seul mois de juillet n'a rien à faire
// dans le menu d'une dépense d'août, où elle ne compterait nulle part.
import { isGroupAlive } from "./forecast";

type Bornes = { id: number; startMonth?: string | null; endMonth?: string | null };

// attachedGroupId : le groupe auquel la transaction est DÉJÀ rattachée. Il reste
// proposé même s'il ne vit plus ce mois-là (bornes changées après coup), sinon le
// menu afficherait un choix vide alors que la transaction est rattachée — et le
// prochain changement effacerait ce rattachement sans que personne l'ait demandé.
export function groupsForMonth<T extends Bornes>(
  groups: T[],
  month: string,
  attachedGroupId?: number | null,
): T[] {
  return groups.filter((g) => isGroupAlive(g, month) || g.id === attachedGroupId);
}
