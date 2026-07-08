"use client";
import { useState } from "react";

type Opt = { id: number; name: string };

export function GroupSelectField({
  name, options, defaultValue,
}: { name: string; options: Opt[]; defaultValue: number | null }) {
  // Contrôlé : sans état local, la soumission de la server action réinitialise
  // le <select> non contrôlé à son defaultValue (la valeur choisie clignotait
  // vers « Automatique » jusqu'au rafraîchissement). L'état conserve le choix.
  const [value, setValue] = useState(defaultValue === null ? "" : String(defaultValue));
  return (
    <select
      name={name}
      value={value}
      className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      onChange={(e) => {
        const form = e.currentTarget.form;
        setValue(e.currentTarget.value);
        form?.requestSubmit();
      }}
    >
      <option value="">Automatique</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
