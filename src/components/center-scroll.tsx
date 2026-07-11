"use client";
import { useEffect, useRef } from "react";

// Défilement horizontal qui, au montage, centre l'élément marqué
// [data-current-month] dans la zone visible.
export function CenterScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const target = c.querySelector<HTMLElement>("[data-current-month]");
    if (!target) return;
    const cRect = c.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const left = c.scrollLeft + (tRect.left - cRect.left) - c.clientWidth / 2 + tRect.width / 2;
    c.scrollLeft = Math.max(0, left);
  }, []);
  return (
    <div ref={ref} className="overflow-x-auto">
      {children}
    </div>
  );
}
