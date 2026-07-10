"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGroup } from "@/app/transactions/actions";

type Opt = { id: number; name: string };

// Trois états : "" = Automatique, "none" = forcé non catégorisé, sinon l'id du groupe.
function stateOf(defaultValue: number | null, excluded: boolean): string {
  if (excluded) return "none";
  return defaultValue === null ? "" : String(defaultValue);
}

export function GroupSelectField({
  txnId, options, defaultValue, excluded = false,
}: { txnId: string; options: Opt[]; defaultValue: number | null; excluded?: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Affiche tout de suite le choix (valeur optimiste), puis suit la vérité
  // serveur : quand l'état serveur change après le refresh, on se resynchronise.
  const server = stateOf(defaultValue, excluded);
  const [value, setValue] = useState(server);
  const [prevServer, setPrevServer] = useState(server);
  if (server !== prevServer) {
    setPrevServer(server);
    setValue(server);
  }

  return (
    <select
      value={value}
      disabled={isPending}
      className="border-input bg-background h-9 rounded-md border px-3 text-sm disabled:opacity-60"
      onChange={(e) => {
        const v = e.currentTarget.value;
        setValue(v);
        const groupId = v === "" || v === "none" ? null : Number.parseInt(v, 10);
        const isExcluded = v === "none";
        startTransition(async () => {
          // revalidatePath seul ne rafraîchit pas la vue courante après l'action ;
          // router.refresh() re-télécharge le rendu serveur de façon fiable.
          await setGroup(txnId, groupId, isExcluded);
          router.refresh();
        });
      }}
    >
      <option value="">Automatique</option>
      <option value="none">Non catégorisé</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
