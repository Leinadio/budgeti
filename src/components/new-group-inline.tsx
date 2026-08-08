"use client";
import { useState } from "react";
import { createGroup } from "@/app/historique/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PeriodFields } from "@/components/period-fields";
import { clampMonth } from "@/lib/history";
import { draftMode, draftStart, type PeriodDraft } from "@/lib/group-period";

// Formulaire de création inline d'une dépense ou d'un revenu, monté juste sous le titre
// de section quand l'utilisateur clique le bouton « + ». Le même formulaire pour les
// deux sens : un revenu se nomme, se dote d'un montant et se borne dans le temps
// exactement comme une dépense. Seuls le sens envoyé et l'exemple du champ « Nom »
// changent.
//
// Un groupe naît plat, avec son montant à lui. Il se découpe ensuite en sous-postes si
// on veut, depuis son panneau — et c'est alors leur somme qui fait son budget. Rien à
// choisir ici : le découpage n'est pas une nature, c'est une suite.
export function NewGroupInline({
  accountId,
  direction = "out",
  stripMin,
  stripMax,
  defaultMonth,
  onDone,
}: {
  accountId: string;
  direction?: "in" | "out";
  stripMin: string;
  stripMax: string;
  defaultMonth: string;
  onDone: () => void;
}) {
  // Mois choisissables : toute la frise du compte, stripMin compris — un budget
  // oublié se rattrape en arrière, pas seulement à partir d'aujourd'hui.
  const defaut = clampMonth(defaultMonth, stripMin, stripMax);

  // Par défaut : à partir du mois de la colonne, sans fin. C'est le cas courant, et il
  // reste plus prudent que « depuis toujours », qui remonterait le groupe sur tout le
  // passé sans qu'on l'ait demandé.
  const [draft, setDraft] = useState<PeriodDraft>({ choice: "from", start: defaut, end: null });
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    await createGroup({
      accountId,
      name: String(formData.get("name") ?? ""),
      amount: Number(formData.get("amount") ?? 0),
      startMonth: draftStart(draft),
      // Sans mois de fin, la durée vaut pour le seul mois de départ : c'est le mode
      // qui le dit (single), le mois de fin envoyé n'est là que pour une plage.
      endMonth: draft.end ?? draft.start,
      period: draftMode(draft),
      direction,
    });
    setPending(false);
    onDone();
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2 py-2 pl-6">
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Nom</Label>
        <Input name="name" required className="max-w-40" placeholder={direction === "in" ? "Ex: Salaire" : "Ex: Courses"} />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Montant €</Label>
        <Input type="number" name="amount" step="0.01" min="0" className="max-w-28" placeholder="0.00" />
      </div>
      <PeriodFields draft={draft} onChange={setDraft} stripMin={stripMin} stripMax={stripMax} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Ajouter</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
    </form>
  );
}
