"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { setIgnored } from "@/app/transactions/actions";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Bascule « non comptabilisée » : la transaction reste visible ici mais sort de
// tous les calculs. Même schéma que GroupSelectField (action serveur puis
// router.refresh(), revalidatePath seul ne rafraîchit pas la vue courante).
export function IgnoreTxnToggle({ txnId, ignored, withLabel = false, size = "icon" }: {
  txnId: string;
  ignored: boolean;
  // Vrai quand la place le permet : un bouton avec son libellé, plus explicite
  // qu'une icône seule. Sinon l'icône, avec le libellé en infobulle.
  withLabel?: boolean;
  // Taille de la variante icône : plus petite quand elle se glisse à côté du menu
  // de rattachement, dans la colonne étroite du tableau de l'historique.
  size?: "icon" | "icon-sm";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const label = ignored ? "Remettre dans les calculs" : "Ne pas comptabiliser";
  const run = () =>
    startTransition(async () => {
      await setIgnored(txnId, !ignored);
      router.refresh();
    });

  if (withLabel) {
    return (
      <Button type="button" variant="outline" size="xs" className="w-fit" disabled={isPending} onClick={run}>
        {ignored ? <EyeOff /> : <Eye />}
        {label}
      </Button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          aria-label={label}
          disabled={isPending}
          onClick={run}
        >
          {ignored ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
