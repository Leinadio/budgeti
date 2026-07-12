import { formatEur } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AccountForecast } from "@/lib/forecast";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";

function Stat({ label, value, red }: { label: string; value: number; red?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("text-xl font-bold tabular-nums", red && "text-red-600")}>{formatEur(value)}</span>
    </div>
  );
}

// Résumé forecast d'un compte (mêmes chiffres que le Prévisionnel), réutilisé
// dans le Prévisionnel et l'Historique.
export function ForecastSummary({ label, forecast: f }: { label: string; forecast: AccountForecast }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-wrap gap-8">
        <Stat label="Solde actuel" value={f.balance} />
        <Stat label="Estimé fin de mois" value={f.currentEstimate} red={f.currentEstimate < 0} />
        <Stat label="Estimé mois prochain" value={f.nextEstimate} red={f.nextEstimate < 0} />
        <Stat label="Mois prochain, dépassements maintenus" value={f.nextEstimateWithOverspend} red={f.nextEstimateWithOverspend < 0} />
      </div>
      <ForecastDetailSheet label={label} forecast={f} />
    </div>
  );
}
