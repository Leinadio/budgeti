"use client";
import { useState } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// Libellé « Juillet 2026 » à partir d'une clé 'YYYY-MM'.
function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Un champ de mois : le mois choisi s'affiche en clair, le calendrier s'ouvre au
// clic et se referme dès qu'on a choisi — un mois est un choix unique, rester
// ouvert n'apporterait rien.
//
// Partagé par les deux endroits où une durée se saisit : la création d'un groupe
// (formulaire sous le titre de section) et l'ajout d'une ligne de récurrent (side
// panel). Les deux doivent proposer exactement les mêmes mois de la même façon.
export function MonthField({ label, value, onChange, min, max, className }: {
  label: string;
  value: string;
  onChange: (m: string) => void;
  min: string;
  max: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <Label className="font-normal">{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className={cn("w-44 justify-between font-normal capitalize", className)}>
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
