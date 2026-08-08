"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { addGroupLine } from "@/app/historique/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PeriodFields } from "@/components/period-fields";
import { clampMonth } from "@/lib/history";
import { draftMode, draftStart, type PeriodDraft } from "@/lib/group-period";

// Formulaire de création inline d'un sous-poste, monté juste sous la ligne de sa
// dépense quand on clique le « + » posé à côté du crayon. Jumeau de NewGroupInline,
// dans les mêmes mots et les mêmes champs : découper une dépense, c'est encore créer
// quelque chose qui a un nom, un montant et une durée.
//
// Il vivait avant dans le panneau de droite, à côté de la gestion du groupe. Le
// panneau demandait d'aller chercher ailleurs ce qu'on voulait faire ici, sous la
// ligne qu'on regardait.
export function NewLineInline({
  groupId,
  stripMin,
  stripMax,
  defaultMonth,
  onDone,
}: {
  groupId: number;
  stripMin: string;
  stripMax: string;
  defaultMonth: string;
  onDone: () => void;
}) {
  const router = useRouter();
  // Mois choisissables : toute la frise du compte, comme pour un groupe.
  const defaut = clampMonth(defaultMonth, stripMin, stripMax);
  const [draft, setDraft] = useState<PeriodDraft>({ choice: "from", start: defaut, end: null });
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    setPending(true);
    const id = await addGroupLine(
      groupId,
      name,
      Number(formData.get("amount") ?? 0),
      draftStart(draft),
      draftMode(draft),
      // Sans mois de fin, la durée vaut pour le seul mois de départ : c'est le mode
      // qui le dit (single), le mois de fin envoyé n'est là que pour une plage.
      draft.end ?? draft.start,
    );
    setPending(false);
    // -1 = rien n'est entré en base (nom vide, plage impossible) : pas d'accusé de
    // réception pour une création qui n'a pas eu lieu.
    if (id > 0) {
      toast.success(`Sous-poste « ${name} » ajouté`);
      router.refresh();
      onDone();
    }
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2 py-2 pl-10">
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Nom</Label>
        <Input name="name" required className="max-w-40" placeholder="Ex: Boulangerie" />
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
