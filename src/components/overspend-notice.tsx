"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/transactions-view";
import { dismissNotification, restoreNotifications } from "@/app/notifications-actions";
import { Button } from "@/components/ui/button";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Le bandeau d'un dépassement, avec son bouton « Vu ». Un seul composant pour les deux
// endroits où il apparaît — le panneau de notifications et le side panel d'une case
// Balance — parce que c'est le même constat : deux rédactions, ce seraient deux
// occasions de dire la chose différemment.
//
// « Vu » acquitte : la notification disparaît, et l'étiquette « dépassement » sous le
// montant aussi. Les deux lisent la même liste, filtrée des acquittés à la source.
export function OverspendNotice({ id, name, month, amount, accountName, seen = false, onDone, onRestore }: {
  id: string;
  name: string;
  month: string;
  amount: number;
  // Nom du compte, affiché seulement là où plusieurs comptes se mélangent (le panneau
  // de notifications). Dans le side panel, le compte est déjà celui qu'on regarde.
  accountName?: string;
  // Déjà acquitté. Le bandeau reste, mais il passe en gris et perd son bouton : il n'y
  // a plus rien à en faire, seulement à savoir que c'est arrivé. Faux par défaut — dans
  // le side panel, les acquittés sont filtrés en amont et n'arrivent jamais ici.
  seen?: boolean;
  // Prévient l'appelant qu'on vient d'acquitter, pour qu'il le montre sans attendre le
  // serveur.
  onDone?: () => void;
  // Idem pour le geste inverse. Absent (le side panel), un bandeau vu n'affiche que la
  // mention : là-bas les acquittés sont filtrés en amont, le cas ne se présente pas.
  onRestore?: () => void;
}) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border p-3 text-sm",
        seen
          ? "bg-muted/40 text-muted-foreground"
          : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950",
      )}
    >
      <TriangleAlert className={cn("mt-0.5 size-4 shrink-0", seen ? "text-muted-foreground/60" : "text-amber-600")} />
      <div className="min-w-0 flex-1">
        <p className={cn(!seen && "font-medium")}>{name}</p>
        <p className="text-muted-foreground">
          Dépassé de <span className="tabular-nums">{NUM.format(amount)} €</span> en {monthLabel(month).toLowerCase()}
        </p>
        {accountName && <p className="text-muted-foreground text-xs">{accountName}</p>}
      </div>
      {seen ? (
        // Acquitter n'est pas une porte qui claque : le bandeau vu porte le geste
        // inverse, à la place exacte du bouton qui l'a fermé. Sans appelant pour le
        // recevoir, on s'en tient à la mention — une case vide laisserait croire que le
        // bandeau attend encore quelque chose.
        onRestore ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground shrink-0"
            disabled={enCours}
            onClick={() => {
              onRestore();
              startTransition(async () => {
                await restoreNotifications([id]);
                router.refresh();
              });
            }}
          >
            <Undo2 className="size-3.5" />
            Non vu
          </Button>
        ) : (
          <span className="text-muted-foreground/70 shrink-0 text-xs">Vu</span>
        )
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={enCours}
          onClick={() => {
            onDone?.();
            startTransition(async () => {
              await dismissNotification(id);
              router.refresh();
            });
          }}
        >
          Vu
        </Button>
      )}
    </div>
  );
}
