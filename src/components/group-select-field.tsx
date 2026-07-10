"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGroup } from "@/app/transactions/actions";

type Opt = { id: number; name: string };

const norm = (v: number | null) => (v === null ? "" : String(v));

export function GroupSelectField({
  txnId, options, defaultValue,
}: { txnId: string; options: Opt[]; defaultValue: number | null }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // Affiche tout de suite le choix (valeur optimiste), puis suit la vérité
  // serveur : quand defaultValue change après le refresh, l'état se resynchronise.
  const [value, setValue] = useState(norm(defaultValue));
  const [prevDefault, setPrevDefault] = useState(defaultValue);
  if (defaultValue !== prevDefault) {
    setPrevDefault(defaultValue);
    setValue(norm(defaultValue));
  }

  return (
    <select
      value={value}
      disabled={isPending}
      className="border-input bg-background h-9 rounded-md border px-3 text-sm disabled:opacity-60"
      onChange={(e) => {
        const v = e.currentTarget.value;
        setValue(v);
        const groupId = v === "" ? null : Number.parseInt(v, 10);
        startTransition(async () => {
          // revalidatePath seul ne rafraîchit pas la vue courante après l'action ;
          // router.refresh() re-télécharge le rendu serveur de façon fiable.
          await setGroup(txnId, groupId);
          router.refresh();
        });
      }}
    >
      <option value="">Automatique</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
