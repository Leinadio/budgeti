"use client";
import { useEffect, useState } from "react";
import { addGroup } from "@/app/groupes/actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Acct = { id: string; name: string };

const selectClass = "border-input bg-background h-9 rounded-md border px-3 text-sm";

// La « nature » pilote sens + type : une dépense choisit enveloppe/récurrent et
// un montant ; une rémunération (principale ou supplémentaire) est toujours une
// enveloppe avec un montant, nom figé, une seule par compte et par type.
export function NewGroupForm({
  accounts,
  remuByAccount,
}: {
  accounts: Acct[];
  remuByAccount: Record<string, { principal: boolean; supplementary: boolean }>;
}) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [nature, setNature] = useState("expense");
  const [kind, setKind] = useState("envelope");
  const isExpense = nature === "expense";
  const isRemu = nature === "principal" || nature === "supplementary";

  const existing = remuByAccount[accountId] ?? { principal: false, supplementary: false };

  // Si la rémunération sélectionnée devient indisponible pour le compte courant
  // (changement de compte, ou rafraîchissement après création réussie qui rend
  // l'option "déjà créée"), on retombe sur "Dépense" plutôt que de laisser le
  // select afficher une option désactivée comme sélectionnée.
  useEffect(() => {
    if ((nature === "principal" && existing.principal) || (nature === "supplementary" && existing.supplementary)) {
      setNature("expense");
    }
  }, [nature, existing.principal, existing.supplementary]);

  return (
    <form action={addGroup} className="flex flex-wrap items-end gap-2">
      <div className="flex w-full flex-col gap-1">
        <Label htmlFor="grp-nature" className="font-normal">Nature</Label>
        <select
          id="grp-nature"
          name="nature"
          value={nature}
          onChange={(e) => setNature(e.target.value)}
          className={cn(selectClass, "max-w-64")}
        >
          <option value="expense">Dépense</option>
          <option value="principal" disabled={existing.principal}>
            Rémunération principale{existing.principal ? " (déjà créée)" : ""}
          </option>
          <option value="supplementary" disabled={existing.supplementary}>
            Rémunération supplémentaire{existing.supplementary ? " (déjà créée)" : ""}
          </option>
        </select>
      </div>
      {isExpense && (
        <div className="flex flex-col gap-1">
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
      )}
      {isExpense && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="grp-name" className="font-normal">Nom</Label>
          <Input id="grp-name" name="name" placeholder="Ex: Courses" required />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="grp-account" className="font-normal">Compte</Label>
        <select
          id="grp-account"
          name="accountId"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={selectClass}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      {((isExpense && kind === "envelope") || isRemu) && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="grp-amount" className="font-normal">Montant €</Label>
          <Input id="grp-amount" type="number" name="monthlyAmount" step="0.01" placeholder="0.00" className="max-w-32" />
        </div>
      )}
      <Button type="submit" size="sm">Ajouter</Button>
    </form>
  );
}
