"use server";
import { db } from "../db/index";
import {
  dismissNotification as dismiss,
  dismissNotifications as dismissAll,
  restoreNotifications as restore,
} from "../db/repositories/dismissed-notifications";
import { revalidatePath } from "next/cache";

// Ferme une notification : elle ne reviendra pas. L'identité vient de
// overspendNotifications (« compte::cible::mois ») et n'est jamais fabriquée ici : la
// composer une seconde fois, c'est prendre le risque qu'elle diverge de celle affichée,
// et fermer une notification en laisser une autre à l'écran.
//
// Toutes les pages sont revalidées : le bouton vit dans l'en-tête, il est donc présent
// partout, et son compteur doit tomber juste où qu'on soit.
export async function dismissNotification(id: string): Promise<void> {
  if (!id) return;
  dismiss(db(), id);
  revalidatePath("/", "layout");
}

// « Tout marquer comme vu ». Les identités viennent du panneau (celles qui restaient à
// voir, cf. unseenIds) et ne sont pas refabriquées ici, pour la même raison que
// ci-dessus : recomposer une identité, c'est risquer d'en acquitter une autre que celle
// qu'on a sous les yeux.
export async function dismissAllNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  dismissAll(db(), ids);
  revalidatePath("/", "layout");
}

// Le geste inverse, pour un dépassement ou pour le lot qu'on vient d'acquitter d'un
// coup. Acquitter n'est pas une décision définitive : rien n'a été détruit, seulement
// marqué, et la marque se retire.
export async function restoreNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  restore(db(), ids);
  revalidatePath("/", "layout");
}
