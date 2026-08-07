"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Undo2 } from "lucide-react";
import { notificationsByMonth, unseenIds, type Notification } from "@/lib/notifications";
import { monthLabel } from "@/lib/transactions-view";
import { dismissAllNotifications, restoreNotifications } from "@/app/notifications-actions";
import { OverspendNotice } from "@/components/overspend-notice";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";

// Bouton de notifications de l'en-tête, et le panneau qui les liste : un bandeau par
// montant dépassé.
//
// Dans l'en-tête et non plus au-dessus du tableau de l'Historique : ces alertes valent
// pour toute l'app et pour tous les comptes, alors que le bandeau d'avant ne parlait que
// du compte affiché et n'existait que sur une page. Un dépassement est un constat, pas
// une question — il n'y a rien à y faire, seulement à le savoir ; relever un budget se
// fait à la main, dans les cases des mois concernés.
//
// Un dépassement acquitté ne quitte pas ce panneau : il y reste en gris. Le faire
// disparaître effaçait la seule trace de ce qui s'est passé ce mois-ci, alors que
// « vu » veut dire « je sais », pas « ça n'a pas eu lieu ». Seul le compteur du bouton
// ne retient que ce qui reste à voir : c'est lui l'alerte.
export function NotificationsButton({ items }: { items: Notification[] }) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  // Ce qu'on vient de changer à l'écran, sans attendre le serveur : le clic doit se
  // voir tout de suite. Une table id → vu, et non deux ensembles, parce que le geste
  // va dans les deux sens. Le rafraîchissement qui suit ramène la même chose depuis la
  // base, et la table devient redondante sans jamais contredire.
  const [local, setLocal] = useState<Record<string, boolean>>({});
  const marquer = (ids: string[], vu: boolean) =>
    setLocal((cur) => ({ ...cur, ...Object.fromEntries(ids.map((id) => [id, vu])) }));

  // Le lot acquitté d'un seul geste, tant que le panneau reste ouvert : c'est lui que
  // « Annuler » rétablit. Fermer le panneau l'oublie — un retour en arrière se propose
  // dans la foulée du geste, pas trois écrans plus tard.
  const [dernierLot, setDernierLot] = useState<string[] | null>(null);

  const affichees = items.map((n) => (n.id in local ? { ...n, seen: local[n.id] } : n));
  const restants = unseenIds(affichees);
  const parMois = notificationsByMonth(affichees);

  const toutVoir = () => {
    const lot = restants;
    marquer(lot, true);
    setDernierLot(lot);
    startTransition(async () => {
      await dismissAllNotifications(lot);
      router.refresh();
    });
  };

  const annuler = () => {
    const lot = dernierLot ?? [];
    marquer(lot, false);
    setDernierLot(null);
    startTransition(async () => {
      await restoreNotifications(lot);
      router.refresh();
    });
  };

  return (
    <Sheet onOpenChange={(ouvert) => !ouvert && setDernierLot(null)}>
      <SheetTrigger asChild>
        {/* Un bouton avec son mot, pas une icône seule : « une cloche » ne dit pas de
            quoi elle parle, et le compte seul encore moins. */}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
        >
          <Bell className="size-4" />
          <span>Dépassements</span>
          {restants.length > 0 && (
            <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 font-sans text-[11px] leading-4 font-semibold text-white">
              {restants.length}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-sm">
        <SheetHeader className="border-b">
          <SheetTitle>Dépassements</SheetTitle>
          <SheetDescription>
            {affichees.length === 0
              ? "Aucun budget dépassé."
              : restants.length === 0
                ? `${affichees.length} budget${affichees.length > 1 ? "s" : ""} dépassé${affichees.length > 1 ? "s" : ""}, tous vus.`
                : `${restants.length} à voir sur ${affichees.length} budget${affichees.length > 1 ? "s" : ""} dépassé${affichees.length > 1 ? "s" : ""}.`}
          </SheetDescription>
          {/* Tout acquitter d'un geste : quand une avalanche de dépassements arrive en
              même temps (un mois qu'on rattrape après coup), les fermer un par un est
              une corvée sans information.
              Une fois le geste fait, le même bouton propose de le défaire — à la même
              place, tant que le panneau reste ouvert. Le reste du temps il s'éteint :
              il n'y a rien à acquitter ni rien à reprendre. */}
          {dernierLot !== null ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-1 self-start"
              disabled={enCours}
              onClick={annuler}
            >
              <Undo2 className="size-4" />
              Annuler
            </Button>
          ) : (
            restants.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-1 self-start"
                disabled={enCours}
                onClick={toutVoir}
              >
                <CheckCheck className="size-4" />
                Tout marquer comme vu
              </Button>
            )
          )}
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto p-4">
          {parMois.map((groupe) => (
            <div key={groupe.month} className="flex flex-col gap-2">
              {/* Le mois en tête de son groupe : un dépassement se lit d'abord par
                  « quand ». Même micro-typographie que les étiquettes du tableau. */}
              <p className="text-muted-foreground/70 text-[10px] tracking-[0.12em] uppercase">
                {monthLabel(groupe.month)}
              </p>
              {groupe.items.map((n) => (
                <OverspendNotice
                  key={n.id}
                  id={n.id}
                  name={n.name}
                  month={n.month}
                  amount={n.amount}
                  accountName={n.accountName}
                  seen={n.seen}
                  onDone={() => marquer([n.id], true)}
                  onRestore={() => marquer([n.id], false)}
                />
              ))}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
