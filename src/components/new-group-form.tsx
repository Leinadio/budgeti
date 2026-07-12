"use client";
import { useState } from "react";
import { addGroup } from "@/app/groupes/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Acct = { id: string; name: string };

const selectClass = "border-input bg-background h-9 rounded-md border px-3 text-sm";

// Le type (récurrent / enveloppe) pilote les champs : le montant n'existe que
// pour une enveloppe ; un récurrent définit ses montants via ses lignes.
export function NewGroupForm({ accounts }: { accounts: Acct[] }) {
  const [kind, setKind] = useState("envelope");
  return (
    <form action={addGroup} className="flex flex-wrap items-end gap-2">
      <div className="flex w-full flex-col gap-1">
        <Label htmlFor="grp-kind" className="font-normal">Type</Label>
        <select
          id="grp-kind"
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className={cn(selectClass, "max-w-40")}
        >
          <option value="envelope">Enveloppe</option>
          <option value="recurring">Récurrent</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="grp-name" className="font-normal">Nom</Label>
        <Input id="grp-name" name="name" placeholder="Ex: Courses" required />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="grp-account" className="font-normal">Compte</Label>
        <select id="grp-account" name="accountId" className={selectClass}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="grp-direction" className="font-normal">Sens</Label>
        <select id="grp-direction" name="direction" className={selectClass}>
          <option value="out">Sortie</option>
          <option value="in">Entrée</option>
        </select>
      </div>
      {kind === "envelope" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="grp-amount" className="font-normal">Montant €</Label>
          <Input id="grp-amount" type="number" name="monthlyAmount" step="0.01" placeholder="0.00" className="max-w-32" />
        </div>
      )}
      <Button type="submit" size="sm">Ajouter</Button>
    </form>
  );
}
