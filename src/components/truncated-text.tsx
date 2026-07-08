"use client";
import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Affiche un texte tronqué avec « … ». Si (et seulement si) le texte est
// réellement coupé, un tooltip shadcn montre le texte entier après un court
// délai de survol. La largeur max se passe via className (ex: "max-w-[460px]").
export function TruncatedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (el) setTruncated(el.scrollWidth > el.clientWidth);
  }, [text]);

  const span = (
    <span ref={ref} className={cn("block truncate", className)}>
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
