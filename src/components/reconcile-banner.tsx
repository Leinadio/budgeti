"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatEur } from "@/lib/money";
import { mergeTransaction, ignoreMatch } from "@/app/transactions/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Line = { id: string; date: string; amount: number; label: string };
type Suggestion = { manual: Line; synced: Line };

export function ReconcileBanner({ suggestions }: { suggestions: Suggestion[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  if (suggestions.length === 0) return null;

  const act = (fn: () => Promise<void>) => startTransition(async () => { await fn(); router.refresh(); });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <p className="text-sm font-medium">
        {suggestions.length} rapprochement{suggestions.length > 1 ? "s" : ""} possible{suggestions.length > 1 ? "s" : ""}
      </p>
      <ul className="flex flex-col gap-3">
        {suggestions.map((s) => (
          <li key={`${s.manual.id}|${s.synced.id}`} className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-sm">
            <span className="flex flex-col">
              <span>Saisie : {s.manual.label} · {s.manual.date} · <span className="tabular-nums">{formatEur(s.manual.amount)}</span></span>
              <span className="text-muted-foreground">Banque : {s.synced.label} · {s.synced.date} · <span className="tabular-nums">{formatEur(s.synced.amount)}</span></span>
            </span>
            <span className="flex gap-2">
              <Button size="sm" disabled={isPending} onClick={() => act(() => mergeTransaction(s.synced.id, s.manual.id))}>Fusionner</Button>
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => act(() => ignoreMatch(s.manual.id, s.synced.id))}>Ce n&apos;est pas la même</Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
