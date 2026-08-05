"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { monthsOfYear, yearHasMonth, yearOf } from "@/lib/month-calendar";

// Un calendrier qui s'arrête au mois : une année de douze cases, des flèches pour
// changer d'année, aucun jour nulle part. Un budget se pose sur un mois entier,
// demander un jour ne ferait qu'obliger à en inventer un.
// Les mois hors bornes restent affichés mais inertes — la règle qui les décide vit
// dans src/lib/month-calendar.ts.

const MONTH_SHORT = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
function shortLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return MONTH_SHORT.format(new Date(Date.UTC(y, m - 1, 1)));
}

export function MonthCalendar({
  value,
  onChange,
  min,
  max,
  className,
}: {
  value: string;
  onChange: (month: string) => void;
  min: string;
  max: string;
  className?: string;
}) {
  // L'année ouverte au départ est celle du mois choisi. Monté dans un popover, ce
  // composant se démonte à la fermeture : chaque ouverture repart du mois courant
  // de la saisie, pas de l'année où on avait navigué la fois d'avant.
  const [year, setYear] = React.useState(() => yearOf(value));
  const cells = monthsOfYear(year, min, max);

  return (
    <div className={cn("w-64", className)}>
      <div className="flex items-center justify-between pb-2">
        <button
          type="button"
          aria-label="Année précédente"
          disabled={!yearHasMonth(year - 1, min, max)}
          onClick={() => setYear(year - 1)}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
        >
          <ChevronLeft />
        </button>
        <div aria-live="polite" className="text-sm font-medium">{year}</div>
        <button
          type="button"
          aria-label="Année suivante"
          disabled={!yearHasMonth(year + 1, min, max)}
          onClick={() => setYear(year + 1)}
          className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
        >
          <ChevronRight />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {cells.map((c) => {
          const selected = c.month === value;
          return (
            <button
              key={c.month}
              type="button"
              disabled={c.disabled}
              aria-pressed={selected}
              onClick={() => onChange(c.month)}
              // Le mois choisi prend la variante « default » du bouton plutôt que
              // des surcharges posées sur « ghost » : ghost porte un dark:hover:
              // qui, à spécificité égale, reprenait le fond au survol pendant que
              // le texte gardait sa couleur de mois choisi. Les deux se
              // confondaient, et le mois disparaissait pile quand on le pointait.
              className={cn(
                buttonVariants({ variant: selected ? "default" : "ghost", size: "sm" }),
                "w-full font-normal capitalize",
              )}
            >
              {shortLabel(c.month)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
