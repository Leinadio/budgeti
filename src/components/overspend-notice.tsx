"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { monthLabel } from "@/lib/transactions-view";
import { dismissNotification } from "@/app/notifications-actions";
import { Button } from "@/components/ui/button";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Le bandeau d'un dépassement, avec son bouton « Vu ». Un seul composant pour les deux
// endroits où il apparaît — le panneau de notifications et le side panel d'une case
// Balance — parce que c'est le même constat : deux rédactions, ce seraient deux
// occasions de dire la chose différemment.
//
// « Vu » acquitte : la notification disparaît, et l'étiquette « dépassement » sous le
// montant aussi. Les deux lisent la même liste, filtrée des acquittés à la source.
export function OverspendNotice({ id, name, month, amount, accountName, onDone }: {
  id: string;
  name: string;
  month: string;
  amount: number;
  // Nom du compte, affiché seulement là où plusieurs comptes se mélangent (le panneau
  // de notifications). Dans le side panel, le compte est déjà celui qu'on regarde.
  accountName?: string;
  // Prévient l'appelant qu'on vient d'acquitter, pour qu'il le montre sans attendre le
  // serveur.
  onDone?: () => void;
}) {
  const router = useRouter();
  const [enCours, startTransition] = useTransition();
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-muted-foreground">
          Dépassé de <span className="tabular-nums">{NUM.format(amount)} €</span> en {monthLabel(month).toLowerCase()}
        </p>
        {accountName && <p className="text-muted-foreground text-xs">{accountName}</p>}
      </div>
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
    </div>
  );
}
