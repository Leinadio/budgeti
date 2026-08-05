"use client";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Affiche un texte tronqué avec « … ». Si (et seulement si) le texte est
// réellement coupé, un tooltip shadcn montre le texte entier après un court
// délai de survol. La largeur max se passe via className (ex: "max-w-[460px]").
//
// `lines` fixe le nombre de lignes avant l'ellipse. Deux lignes valent mieux pour un
// libellé bancaire, où l'essentiel arrive tard : « PAIEMENT PSC 0408 ISSOIRE… » ne dit
// rien, le marchand est plus loin. Les colonnes étroites gardent une seule ligne.
export function TruncatedText({ text, className, lines = 1 }: { text: string; className?: string; lines?: 1 | 2 }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  // Les deux sens sont testés : sur une ligne le texte déborde en largeur, sur deux
  // il déborde en hauteur (line-clamp coupe verticalement).
  useEffect(() => {
    const el = ref.current;
    if (el) setTruncated(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
  }, [text, lines]);

  // `whitespace-normal` est indispensable sur deux lignes : les cellules du tableau
  // portent whitespace-nowrap (ui/table.tsx), hérité jusqu'ici. Sans lui le texte
  // reste sur une seule ligne, line-clamp n'a rien à couper, et la ligne déborde en
  // se faisant rogner par l'overflow — sans même l'ellipse. `break-words` rattrape le
  // cas d'un libellé d'un seul tenant, plus large que la colonne.
  const span = (
    <span
      ref={ref}
      className={cn(lines === 2 ? "line-clamp-2 break-words whitespace-normal" : "block truncate", className)}
    >
      {text}
    </span>
  );

  if (!truncated) return span;

  return (
    <Tooltip delayDuration={700}>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent className="max-w-sm break-words">{text}</TooltipContent>
    </Tooltip>
  );
}
