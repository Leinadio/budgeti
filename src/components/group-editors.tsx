"use client";
import { useState, useTransition, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { editGroup, editLine, removeGroup, removeLine } from "@/app/groupes/actions";
import { formatEur } from "@/lib/money";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const selectClass = "border-input bg-background h-9 rounded-md border px-3 text-sm";

type Group = {
  id: number;
  name: string;
  direction: "in" | "out";
  kind: "envelope" | "recurring";
  monthlyAmount: number | null;
  incomeKind?: "principal" | "supplementary" | null;
};

// En-tête de groupe : affichage, ou formulaire d'édition (nom, sens, montant si enveloppe).
export function EditableGroupHeader({
  group,
  accountName,
  total,
}: {
  group: Group;
  accountName: string;
  total: number;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      await editGroup(fd);
      setEditing(false);
    });
  }

  if (editing) {
    const isRemu = group.incomeKind != null;
    return (
      <form onSubmit={onSubmit} className="flex w-full flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={group.id} />
        <input type="hidden" name="kind" value={group.kind} />
        {isRemu ? (
          <>
            <div className="flex flex-col gap-1">
              <Label className="font-normal">Nom</Label>
              <span className="text-sm">{group.name}</span>
              <input type="hidden" name="name" value={group.name} />
            </div>
            <input type="hidden" name="direction" value="in" />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Label className="font-normal">Nom</Label>
              <Input name="name" defaultValue={group.name} required className="max-w-48" />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="font-normal">Sens</Label>
              <select name="direction" defaultValue={group.direction} className={selectClass}>
                <option value="out">Sortie</option>
                <option value="in">Entrée</option>
              </select>
            </div>
          </>
        )}
        {group.kind === "envelope" && (
          <div className="flex flex-col gap-1">
            <Label className="font-normal">Montant €</Label>
            <Input
              type="number"
              name="monthlyAmount"
              step="0.01"
              defaultValue={group.monthlyAmount ?? 0}
              className="max-w-32"
            />
          </div>
        )}
        <Button type="submit" size="sm" disabled={pending}>Enregistrer</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Annuler
        </Button>
      </form>
    );
  }

  return (
    <div className="flex w-full items-baseline justify-between">
      <span className="text-base leading-none font-semibold">
        {group.name}{" "}
        <span className="text-muted-foreground text-sm font-normal">
          {accountName} · {group.direction === "in" ? "Entrée" : "Sortie"} ·{" "}
          {group.kind === "envelope" ? "Enveloppe" : "Récurrents"}
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-sm font-medium">{formatEur(total)}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
          Modifier
        </Button>
        <form action={removeGroup}>
          <input type="hidden" name="id" value={group.id} />
          <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
        </form>
      </span>
    </div>
  );
}

type Line = { id: number; name: string; amount: number; day: number; keyword: string };

// Une ligne de récurrent : affichage ou formulaire d'édition.
export function EditableLine({ line }: { line: Line }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      await editLine(fd);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 py-1">
        <input type="hidden" name="id" value={line.id} />
        <div className="flex flex-col gap-1">
          <Label className="font-normal">Nom</Label>
          <Input name="name" defaultValue={line.name} required className="max-w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="font-normal">Montant €</Label>
          <Input type="number" name="amount" step="0.01" defaultValue={line.amount} className="max-w-28" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="font-normal">Jour</Label>
          <Input type="number" name="day" min="1" max="31" defaultValue={line.day} required className="max-w-24" />
        </div>
        <Button type="submit" size="sm" disabled={pending}>Enregistrer</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Annuler
        </Button>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between text-sm">
      <span>
        {line.name}
        <span className="text-muted-foreground"> · le {line.day}</span>
      </span>
      <span className="flex items-center gap-2">
        <span>{formatEur(line.amount)}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          <Pencil className="size-4" />
        </Button>
        <form action={removeLine}>
          <input type="hidden" name="id" value={line.id} />
          <Button type="submit" size="sm" variant="ghost">×</Button>
        </form>
      </span>
    </div>
  );
}
