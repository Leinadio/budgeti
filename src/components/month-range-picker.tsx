"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonthsKey, monthRange } from "@/lib/history";
import { cn } from "@/lib/utils";

const MONTHS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const shortLabel = (m: string) => MONTHS_FR[Number(m.slice(5, 7)) - 1];
const yearOf = (m: string) => m.slice(0, 4);

// Bande de mois façon Actual Budget : clic début puis clic fin pour choisir la
// plage affichée. La plage est écrite dans l'URL (?from&to), lue par la page.
export function MonthRangePicker({ min, max, from, to, current }: {
  min: string;
  max: string;
  from: string;
  to: string;
  current: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const scroller = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<string | null>(null);

  const months = monthRange(min, max);
  // Milieu de la plage sélectionnée, centré à l'ouverture.
  const selected = monthRange(from, to);
  const mid = selected[Math.floor((selected.length - 1) / 2)];

  // Centre la sélection à l'ouverture.
  useEffect(() => {
    midRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [mid]);

  const onPick = (m: string) => {
    if (anchor === null) {
      setAnchor(m);
      return;
    }
    const lo = anchor <= m ? anchor : m;
    const hi = anchor <= m ? m : anchor;
    setAnchor(null);
    router.push(`${pathname}?from=${lo}&to=${hi}`);
  };

  const scrollBy = (dir: -1 | 1) => scroller.current?.scrollBy({ left: dir * 260, behavior: "smooth" });

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="Défiler vers la gauche"
        onClick={() => scrollBy(-1)}
        className="hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-md"
      >
        <ChevronLeft className="size-4" />
      </button>

      <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto scroll-px-2 py-1">
        {/* mx-auto : centre la frise quand elle tient, défile sans rognage quand elle déborde. */}
        <div className="mx-auto flex w-fit gap-0.5 px-1">
        {months.map((m) => {
          const selected = m >= from && m <= to;
          const isAnchor = m === anchor;
          const showYear = m.slice(5, 7) === "01" || m === months[0];
          return (
            <div key={m} className="flex flex-col items-center">
              <span className="text-muted-foreground h-4 text-[10px] leading-4">
                {showYear ? yearOf(m) : ""}
              </span>
              <button
                ref={m === mid ? midRef : undefined}
                type="button"
                onClick={() => onPick(m)}
                className={cn(
                  "w-11 rounded-md py-1 text-center text-xs capitalize transition-colors",
                  selected ? "bg-primary text-primary-foreground" : "hover:bg-muted",
                  isAnchor && "ring-primary ring-2",
                  m === current && "font-semibold",
                )}
              >
                {shortLabel(m)}
              </button>
              {/* Pastille sous le mois courant, toujours visible (repère « aujourd'hui »).
                  Hauteur réservée sur chaque colonne pour garder l'alignement. */}
              <span className="mt-0.5 flex h-1.5 items-center justify-center">
                {m === current && <span className="bg-primary size-1.5 rounded-full" />}
              </span>
            </div>
          );
        })}
        </div>
      </div>

      <button
        type="button"
        aria-label="Défiler vers la droite"
        onClick={() => scrollBy(1)}
        className="hover:bg-muted flex size-8 shrink-0 items-center justify-center rounded-md"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
