"use client";

type Opt = { id: number; name: string };

export function GroupSelectField({
  name, options, defaultValue,
}: { name: string; options: Opt[]; defaultValue: number | null }) {
  return (
    <select
      name={name}
      defaultValue={defaultValue === null ? "" : String(defaultValue)}
      className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      <option value="">Automatique</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name}</option>
      ))}
    </select>
  );
}
