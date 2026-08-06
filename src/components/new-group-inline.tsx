"use client";
import { useState } from "react";
import { createGroup } from "@/app/historique/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonthField } from "@/components/month-field";
import { clampMonth } from "@/lib/history";
import { minEndMonth, fitEndMonth, type PeriodMode } from "@/lib/group-period";

// Les trois façons de dire jusqu'à quand un groupe vit. Les libellés parlent de
// mois, pas de « portée » : c'est la question qu'on se pose en créant la ligne.
export const PERIODS: { value: PeriodMode; label: string }[] = [
  { value: "from", label: "À partir d'un mois, et les suivants" },
  { value: "single", label: "Un seul mois" },
  { value: "range", label: "D'un mois à un autre" },
];

// Formulaire de création inline d'un groupe (enveloppe ou récurrent), monté
// juste sous le titre de section quand l'utilisateur clique le bouton « + ».
// Toujours en dépense : direction et incomeKind sont fixés côté server action.
export function NewGroupInline({
  accountId,
  kind,
  stripMin,
  stripMax,
  defaultMonth,
  onDone,
}: {
  accountId: string;
  kind: "envelope" | "recurring";
  stripMin: string;
  stripMax: string;
  defaultMonth: string;
  onDone: () => void;
}) {
  // Mois choisissables : toute la frise du compte, stripMin compris — un budget
  // oublié se rattrape en arrière, pas seulement à partir d'aujourd'hui.
  const defaut = clampMonth(defaultMonth, stripMin, stripMax);

  const [period, setPeriod] = useState<PeriodMode>("from");
  const [start, setStart] = useState(defaut);
  const [end, setEnd] = useState(minEndMonth(defaut));
  const [pending, setPending] = useState(false);

  // Changer le début peut rattraper la fin ; on la repousse au premier mois encore
  // permis plutôt que de garder affiché un mois que le calendrier de fin refuse
  // désormais. Une plage finit forcément APRÈS son début (cf. minEndMonth) : finir le
  // mois où l'on commence, c'est « un seul mois », qui a son propre choix juste
  // au-dessus.
  const changeStart = (m: string) => {
    setStart(m);
    setEnd(fitEndMonth(m, end));
  };

  async function submit(formData: FormData) {
    setPending(true);
    await createGroup({
      accountId,
      kind,
      name: String(formData.get("name") ?? ""),
      amount: kind === "envelope" ? Number(formData.get("amount") ?? 0) : null,
      startMonth: start,
      endMonth: end,
      period,
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
        <Label className="font-normal">Durée</Label>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as PeriodMode)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
        >
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      {/* Les mois demandés suivent la durée choisie : un seul champ pour un mois
          unique ou un début sans fin, deux pour une plage. */}
      <MonthField
        label={period === "range" ? "Du mois" : period === "single" ? "Mois" : "À partir de"}
        value={start}
        onChange={changeStart}
        min={stripMin}
        max={stripMax}
      />
      {/* Une fin tombe forcément après son début : le calendrier de fin part du mois
          SUIVANT. Si le début est le dernier mois de la frise, ce calendrier n'a plus
          rien à proposer — c'est le signe qu'il fallait choisir « un seul mois ». */}
      {period === "range" && (
        <MonthField label="Jusqu'au mois" value={end} onChange={setEnd} min={minEndMonth(start)} max={stripMax} />
      )}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Ajouter</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
    </form>
  );
}
