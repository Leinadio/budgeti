"use client";
import { useState } from "react";
import { Calendar } from "lucide-react";
import { createGroup } from "@/app/historique/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clampMonth } from "@/lib/history";
import { type PeriodMode } from "@/lib/group-period";

// Libellé « Juillet 2026 » à partir d'une clé 'YYYY-MM'.
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Les trois façons de dire jusqu'à quand un groupe vit. Les libellés parlent de
// mois, pas de « portée » : c'est la question qu'on se pose en créant la ligne.
const PERIODS: { value: PeriodMode; label: string }[] = [
  { value: "from", label: "À partir d'un mois, et les suivants" },
  { value: "single", label: "Un seul mois" },
  { value: "range", label: "D'un mois à un autre" },
];

// Un champ de mois : le mois choisi s'affiche en clair, le calendrier s'ouvre au
// clic et se referme dès qu'on a choisi — un mois est un choix unique, rester
// ouvert n'apporterait rien.
function MonthField({ label, value, onChange, min, max }: {
  label: string;
  value: string;
  onChange: (m: string) => void;
  min: string;
  max: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <Label className="font-normal">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-44 justify-between font-normal capitalize">
            {monthLabel(value)}
            <Calendar className="opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-2">
          <MonthCalendar
            value={value}
            min={min}
            max={max}
            onChange={(m) => { onChange(m); setOpen(false); }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

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
  const [end, setEnd] = useState(defaut);
  const [pending, setPending] = useState(false);

  // Changer le début peut rendre la fin caduque ; on la ramène au début plutôt que
  // de garder affiché un mois que le calendrier de fin refuse désormais.
  const changeStart = (m: string) => {
    setStart(m);
    if (end < m) setEnd(m);
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
      {/* Une fin ne peut pas précéder son début : le calendrier de fin part de là. */}
      {period === "range" && (
        <MonthField label="Jusqu'au mois" value={end} onChange={setEnd} min={start} max={stripMax} />
      )}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>Ajouter</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDone}>Annuler</Button>
    </form>
  );
}
