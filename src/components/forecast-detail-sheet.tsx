"use client";
import { Info } from "lucide-react";
import { formatEur } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { AccountForecast, ForecastStep } from "@/lib/forecast";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

function Amount({ n }: { n: number }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", n < 0 ? "text-red-600" : "text-emerald-600")}>
      {n >= 0 ? "+" : ""}
      {formatEur(n)}
    </span>
  );
}

function Line({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1 text-sm",
        strong && "mt-1 border-t pt-2 font-semibold",
      )}
    >
      <span className={cn(!strong && "text-muted-foreground")}>{label}</span>
      {value}
    </div>
  );
}

function Breakdown({ start, startLabel, steps, total, totalLabel }: {
  start: number;
  startLabel: string;
  steps: ForecastStep[];
  total: number;
  totalLabel: string;
}) {
  return (
    <div className="rounded-lg border p-3">
      <Line label={startLabel} value={<span className="tabular-nums whitespace-nowrap">{formatEur(start)}</span>} />
      {steps.length === 0 ? (
        <p className="py-1 text-muted-foreground text-sm">Rien de prévu, l&apos;estimé reste identique.</p>
      ) : (
        steps.map((s, i) => <Line key={i} label={s.label} value={<Amount n={s.amount} />} />)
      )}
      <Line label={totalLabel} value={<span className={cn("tabular-nums whitespace-nowrap", total < 0 && "text-red-600")}>{formatEur(total)}</span>} strong />
    </div>
  );
}

export function ForecastDetailSheet({ label, forecast: f }: { label: string; forecast: AccountForecast }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Info className="size-4" />
          Détail du calcul
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Détail du prévisionnel</SheetTitle>
          <SheetDescription>{label}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold">Solde actuel · {formatEur(f.balance)}</h3>
            <p className="text-muted-foreground text-sm">
              Ce que tu as réellement sur le compte en ce moment. C&apos;est le seul chiffre certain, tout le reste est une projection.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={cn("font-semibold", f.currentEstimate < 0 && "text-red-600")}>
              Estimé fin de mois · {formatEur(f.currentEstimate)}
            </h3>
            <p className="text-muted-foreground text-sm">
              On part du solde actuel et on retire ce qui doit encore sortir d&apos;ici la fin du mois : la part non encore
              dépensée de chaque enveloppe, et les échéances récurrentes pas encore prélevées. Les revenus pas encore reçus
              sont ajoutés.
            </p>
            <Breakdown
              start={f.balance}
              startLabel="Solde actuel"
              steps={f.currentSteps}
              total={f.currentEstimate}
              totalLabel="Estimé fin de mois"
            />
          </section>

          <section className="flex flex-col gap-2">
            <h3 className={cn("font-semibold", f.nextEstimate < 0 && "text-red-600")}>
              Estimé mois prochain · {formatEur(f.nextEstimate)}
            </h3>
            <p className="text-muted-foreground text-sm">
              On repart de l&apos;estimé de fin de mois et on applique un mois complet de tous tes groupes : budgets
              d&apos;enveloppes, échéances récurrentes et revenus. C&apos;est une tendance, si tu gardes le même rythme.
            </p>
            <Breakdown
              start={f.currentEstimate}
              startLabel="Estimé fin de mois"
              steps={f.nextSteps}
              total={f.nextEstimate}
              totalLabel="Estimé mois prochain"
            />
          </section>

          {f.overspendTotal > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className={cn("font-semibold", f.nextEstimateWithOverspend < 0 && "text-red-600")}>
                Mois prochain, dépassements maintenus · {formatEur(f.nextEstimateWithOverspend)}
              </h3>
              <p className="text-muted-foreground text-sm">
                L&apos;estimé mois prochain suppose que chaque enveloppe coûte pile son budget. Si les groupes qui ont
                dépassé ce mois-ci continuent au même rythme, voilà où tu atterris.
              </p>
              <Breakdown
                start={f.nextEstimate}
                startLabel="Estimé mois prochain"
                steps={f.overspendSteps}
                total={f.nextEstimateWithOverspend}
                totalLabel="Dépassements maintenus"
              />
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
