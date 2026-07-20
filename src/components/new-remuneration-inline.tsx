"use client";
import { useState } from "react";
import { createRemuneration } from "@/app/historique/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Formulaire de création inline d'une rémunération (principale ou supplémentaire),
// monté sous le titre de la section Rémunérations quand l'utilisateur clique le
// bouton correspondant. Contrairement à NewGroupInline (groupes de dépense), pas
// de mois de départ ni de portée : les rémunérations sont toujours permanentes,
// direction et incomeKind fixés côté server action.
export function NewRemunerationInline({
  accountId,
  incomeKind,
  onDone,
}: {
  accountId: string;
  incomeKind: "principal" | "supplementary";
  onDone: () => void;
}) {
  const [pending, setPending] = useState(false);
  const label = incomeKind === "principal" ? "Rémunération principale" : "Rémunération supplémentaire";

  async function submit(formData: FormData) {
    setPending(true);
    await createRemuneration(accountId, incomeKind, Number(formData.get("amount") ?? 0));
    setPending(false);
    onDone();
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2 py-2 pl-6">
      <div className="flex flex-col gap-1">
        <Label className="font-normal">{label} — montant €</Label>
        <Input type="number" name="amount" step="0.01" min="0" required autoFocus className="max-w-28" placeholder="0.00" />
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Ajouter</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
    </form>
  );
}
