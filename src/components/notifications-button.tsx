"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import type { Notification } from "@/lib/notifications";
import { OverspendNotice } from "@/components/overspend-notice";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from "@/components/ui/sheet";

// Bouton de notifications de l'en-tête, et le panneau qui les liste : un bandeau par
// montant dépassé.
//
// Dans l'en-tête et non plus au-dessus du tableau de l'Historique : ces alertes valent
// pour toute l'app et pour tous les comptes, alors que le bandeau d'avant ne parlait que
// du compte affiché et n'existait que sur une page. Un dépassement est un constat, pas
// une question — il n'y a rien à y faire, seulement à le savoir ; relever un budget se
// fait à la main, dans les cases des mois concernés.
export function NotificationsButton({ items }: { items: Notification[] }) {
  // Notifications acquittées à l'instant, affichées comme parties sans attendre le
  // serveur : le clic sur « Vu » doit se voir tout de suite. Le rafraîchissement qui
  // suit les fera disparaître pour de bon (elles sont alors filtrées en base).
  const [fermees, setFermees] = useState<Set<string>>(new Set());
  const visibles = items.filter((n) => !fermees.has(n.id));
  return (
    <Sheet>
      <SheetTrigger asChild>
        {/* Un bouton avec son mot, pas une icône seule : « une cloche » ne dit pas de
            quoi elle parle, et le compte seul encore moins. */}
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm"
        >
          <Bell className="size-4" />
          <span>Dépassements</span>
          {visibles.length > 0 && (
            <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1 font-sans text-[11px] leading-4 font-semibold text-white">
              {visibles.length}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-sm">
        <SheetHeader className="border-b">
          <SheetTitle>Dépassements</SheetTitle>
          <SheetDescription>
            {visibles.length === 0
              ? "Aucun budget dépassé."
              : `${visibles.length} budget${visibles.length > 1 ? "s" : ""} dépassé${visibles.length > 1 ? "s" : ""}.`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto p-4">
          {visibles.map((n) => (
            <OverspendNotice
              key={n.id}
              id={n.id}
              name={n.name}
              month={n.month}
              amount={n.amount}
              accountName={n.accountName}
              onDone={() => setFermees((cur) => new Set(cur).add(n.id))}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
