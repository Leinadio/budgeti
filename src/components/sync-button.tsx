"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { syncMessage } from "@/lib/sync-message";

// Rafraîchit les transactions depuis la banque, depuis l'en-tête. Le même appel que le
// bouton « Synchroniser » des Réglages (POST /api/sync) : c'est le geste qu'on fait le
// plus souvent, il n'avait rien à faire au fond d'une page de configuration.
//
// Pas une server action mais l'API existante : la synchronisation parle à Enable
// Banking et peut durer, et cette route sait déjà rendre le compte de ce qui est entré
// comme les erreurs de la banque. Une fois finie, router.refresh() recharge la page
// courante — sans quoi le tableau montrerait encore l'avant.
export function SyncButton() {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);

  const rafraichir = async () => {
    setEnCours(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = (await res.json()) as { imported?: number; error?: string };
      if (!res.ok) {
        // Le seul refus qu'on sait traduire : pas de banque connectée. Le reste vient
        // de la banque et se dit tel quel, plutôt que d'être noyé dans un « erreur ».
        toast.error(
          data.error === "not_connected"
            ? "Aucune banque connectée. À faire dans Réglages."
            : `Synchronisation impossible : ${data.error ?? "erreur inconnue"}`,
        );
        return;
      }
      toast.success(syncMessage(Number(data.imported)));
      router.refresh();
    } catch {
      toast.error("Serveur injoignable : la synchronisation n'a pas eu lieu.");
    } finally {
      setEnCours(false);
    }
  };

  return (
    <button
      type="button"
      onClick={rafraichir}
      disabled={enCours}
      // Mêmes formes que le bouton voisin des dépassements : ils vont par paire dans
      // l'en-tête, et deux dessins différents les feraient lire comme deux natures.
      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm disabled:opacity-60"
    >
      <RefreshCw className={cn("size-4", enCours && "animate-spin")} />
      <span>{enCours ? "Synchronisation…" : "Rafraîchir"}</span>
    </button>
  );
}
