"use client";
import { useState } from "react";
import { createGroup } from "@/app/historique/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addMonthsKey } from "@/lib/history";

// Libellé « Juillet 2026 » à partir d'une clé 'YYYY-MM'.
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Formulaire de création inline d'un groupe (enveloppe ou récurrent), monté
// juste sous le titre de section quand l'utilisateur clique le bouton « + ».
// Toujours en dépense : direction et incomeKind sont fixés côté server action.
export function NewGroupInline({
  accountId,
  kind,
  currentMonth,
  stripMax,
  defaultMonth,
  onDone,
}: {
  accountId: string;
  kind: "envelope" | "recurring";
  currentMonth: string;
  stripMax: string;
  defaultMonth: string;
  onDone: () => void;
}) {
  // Options de mois : de currentMonth (jamais dans le passé) jusqu'à stripMax.
  const months: string[] = [];
  for (let m = currentMonth; m <= stripMax; m = addMonthsKey(m, 1)) months.push(m);
  const start = defaultMonth >= currentMonth && defaultMonth <= stripMax ? defaultMonth : currentMonth;
  const [pending, setPending] = useState(false);

  async function submit(formData: FormData) {
    setPending(true);
    await createGroup({
      accountId,
      kind,
      name: String(formData.get("name") ?? ""),
      amount: kind === "envelope" ? Number(formData.get("amount") ?? 0) : null,
      startMonth: String(formData.get("startMonth") ?? currentMonth),
      scope: (String(formData.get("scope") ?? "ongoing") as "once" | "ongoing"),
    });
    setPending(false);
    onDone();
  }

  return (
    <form action={submit} className="flex flex-wrap items-end gap-2 py-2 pl-6">
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Nom</Label>
        <Input name="name" required className="max-w-40" placeholder={kind === "envelope" ? "Ex: Courses" : "Ex: Abonnements"} />
      </div>
      {kind === "envelope" && (
        <div className="flex flex-col gap-1">
          <Label className="font-normal">Montant €</Label>
          <Input type="number" name="amount" step="0.01" min="0" className="max-w-28" placeholder="0.00" />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Mois de départ</Label>
        <select name="startMonth" defaultValue={start} className="h-9 rounded-md border bg-transparent px-2 text-sm">
          {months.map((m) => (
            <option key={m} value={m}>{monthLabel(m)}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="font-normal">Portée</Label>
        <select name="scope" defaultValue="ongoing" className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="ongoing">Permanent (mois suivants aussi)</option>
          <option value="once">Ce mois seulement</option>
        </select>
      </div>
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Ajouter</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
    </form>
  );
}
