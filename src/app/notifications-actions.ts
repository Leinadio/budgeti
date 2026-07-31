"use server";
import { db } from "../db/index";
import { dismissNotification as dismiss } from "../db/repositories/dismissed-notifications";
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
