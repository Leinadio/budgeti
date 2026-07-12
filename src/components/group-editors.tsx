"use client";
import { useState, useTransition, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { editGroup, editGroupKeyword, editLine, removeGroup, removeLine } from "@/app/groupes/actions";
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
    return (
      <form onSubmit={onSubmit} className="flex w-full flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={group.id} />
        <input type="hidden" name="kind" value={group.kind} />
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

// Un mot-clé d'enveloppe : affichage ou champ d'édition.
export function EditableKeyword({ groupId, keyword }: { groupId: number; keyword: string }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      await editGroupKeyword(fd);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <form onSubmit={onSubmit} className="flex items-center gap-1">
        <input type="hidden" name="groupId" value={groupId} />
        <input type="hidden" name="oldKeyword" value={keyword} />
        <Input name="keyword" defaultValue={keyword} required className="h-7 max-w-40 text-sm" />
        <Button type="submit" size="sm" variant="ghost" className="h-7" disabled={pending}>
          OK
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setEditing(false)}>
          ×
        </Button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="hover:bg-muted inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm"
    >
      {keyword}
      <Pencil className="text-muted-foreground size-3" />
    </button>
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
        <div className="flex flex-col gap-1">
          <Label className="font-normal">Mot-clé</Label>
          <Input name="keyword" defaultValue={line.keyword} required className="max-w-40" />
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
        <span className="text-muted-foreground"> · {line.keyword} · le {line.day}</span>
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
