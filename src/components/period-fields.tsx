"use client";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MonthField } from "@/components/month-field";
import { minEndMonth, fitEndMonth, type PeriodDraft } from "@/lib/group-period";
import { cn } from "@/lib/utils";

// La durée de vie, telle qu'on la demande à l'écran : deux choix, et un « + » pour
// ajouter un mois de fin. Un seul composant pour les quatre endroits où la question se
// pose (créer un groupe, créer une ligne, modifier l'un ou l'autre) : ce sont les mêmes
// mots et les mêmes mois, il n'y a aucune raison qu'ils diffèrent d'un écran à l'autre.
//
// Sans mois de fin, « des mois précis » vaut pour CE mois seulement : c'est le sens du
// « + », qui ajoute une fin plutôt que de la demander d'emblée (cf. draftMode).
export function PeriodFields({ draft, onChange, stripMin, stripMax, compact = false }: {
  draft: PeriodDraft;
  onChange: (d: PeriodDraft) => void;
  stripMin: string;
  stripMax: string;
  compact?: boolean;
}) {
  const { choice, start, end } = draft;
  const champ = compact ? "h-8 w-40" : undefined;
  // Changer le début peut rattraper la fin : elle repart au premier mois encore
  // permis, plutôt que de rester sur un mois que le formulaire refusera.
  const changeStart = (m: string) => onChange({ ...draft, start: m, end: end === null ? null : fitEndMonth(m, end) });
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label className={cn("font-normal", compact && "text-muted-foreground text-xs")}>Durée</Label>
        <select
          value={choice}
          onChange={(e) => onChange({ ...draft, choice: e.target.value as PeriodDraft["choice"] })}
          className={cn("rounded-md border bg-transparent px-2 text-sm", compact ? "h-8" : "h-9")}
        >
          <option value="permanent">Permanent</option>
          <option value="dates">Sur des mois précis</option>
        </select>
      </div>
      <MonthField
        label={choice === "permanent" ? "À partir de" : end === null ? "Mois" : "Du mois"}
        value={start}
        onChange={changeStart}
        min={stripMin}
        max={stripMax}
        className={champ}
      />
      {choice === "dates" &&
        (end === null ? (
          // Pas de fin = ce mois seulement. Le « + » est le geste qui étale la durée
          // sur plusieurs mois, sans avoir eu à le décider dans le menu.
          <Button
            type="button"
            variant="outline"
            size={compact ? "sm" : "default"}
            onClick={() => onChange({ ...draft, end: minEndMonth(start) })}
          >
            <Plus />
            Jusqu&apos;à un mois
          </Button>
        ) : (
          <div className="flex items-end gap-1">
            {/* Une fin tombe forcément après son début (cf. minEndMonth) : finir le
                mois où l'on commence, c'est « ce mois seulement », donc pas de fin. */}
            <MonthField
              label="Jusqu'au mois"
              value={end}
              onChange={(m) => onChange({ ...draft, end: m })}
              min={minEndMonth(start)}
              max={stripMax}
              className={champ}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Retirer le mois de fin"
              className={compact ? "size-8" : undefined}
              onClick={() => onChange({ ...draft, end: null })}
            >
              <X />
            </Button>
          </div>
        ))}
    </>
  );
}
