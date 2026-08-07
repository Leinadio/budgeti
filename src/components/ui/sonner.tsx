"use client";

import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Le composant shadcn, à deux écarts près.
//
// Le premier : pas de next-themes. L'app ne l'utilise pas — le thème sombre se pose
// par un script en ligne qui bascule une classe sur <html> d'après la préférence
// système (cf. layout.tsx). « system » dit à sonner de lire la même préférence, ce qui
// revient au même sans ajouter une dépendance pour une seule lecture.
//
// Le second : les couleurs du succès. Un toast d'accusé de réception est vert, et ce
// vert est déjà celui de l'app — celui des montants positifs du tableau
// (text-green-600). Le fond reste un color-mix avec le popover, comme toutes les
// teintes de l'app : il se réchauffe avec le fond papier au lieu de plaquer un vert
// d'écran par-dessus.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "color-mix(in oklab, var(--color-green-600) 12%, var(--popover))",
          "--success-text": "var(--popover-foreground)",
          "--success-border": "color-mix(in oklab, var(--color-green-600) 45%, var(--border))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
