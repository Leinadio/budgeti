"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setIncomeKind } from "@/app/transactions/actions";

// Étiquette une entrée (revenu) « principale » ou « supplémentaire ». Une entrée
// non étiquetée compte comme principale, donc on affiche « Principale » par défaut.
export function IncomeKindSelect({ txnId, value }: { txnId: string; value: "principal" | "supplementary" | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const server: "principal" | "supplementary" = value ?? "principal";
  const [v, setV] = useState<"principal" | "supplementary">(server);
  const [prevServer, setPrevServer] = useState(server);
  if (server !== prevServer) {
    setPrevServer(server);
    setV(server);
  }
  return (
    <select
      value={v}
      disabled={isPending}
      className="border-input bg-background mt-1 h-8 rounded-md border px-2 text-xs disabled:opacity-60"
      onChange={(e) => {
        const nv = e.currentTarget.value as "principal" | "supplementary";
        setV(nv);
        startTransition(async () => {
          await setIncomeKind(txnId, nv);
          router.refresh();
        });
      }}
    >
      <option value="principal">Principale</option>
      <option value="supplementary">Supplémentaire</option>
    </select>
  );
}
