"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { addTransaction, editTransaction } from "@/app/transactions/actions";
import type { ManualFormInput } from "@/lib/manual-txn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

type AccountOpt = { id: string; label: string };
type GroupOpt = { id: number; name: string; accountId: string; direction: "in" | "out" };
type EditData = {
  id: string; accountId: string; date: string; direction: "in" | "out";
  amount: number; label: string; groupId: number | null; incomeKind: "principal" | "supplementary" | null;
};

export function AddTransactionSheet({ accounts, groups, edit }: { accounts: AccountOpt[]; groups: GroupOpt[]; edit?: EditData }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [accountId, setAccountId] = useState(edit?.accountId ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(edit?.date ?? "");
  const [direction, setDirection] = useState<"in" | "out">(edit?.direction ?? "out");
  const [amount, setAmount] = useState(edit ? String(Math.abs(edit.amount)) : "");
  const [label, setLabel] = useState(edit?.label ?? "");
  const [groupId, setGroupId] = useState<number | null>(edit?.groupId ?? null);
  const [incomeKind, setIncomeKind] = useState<"principal" | "supplementary">(edit?.incomeKind ?? "principal");

  const groupChoices = groups.filter((g) => g.accountId === accountId && g.direction === direction);

  const submit = () => {
    const form: ManualFormInput = {
      accountId, date, direction, amount: Number(amount.replace(",", ".")),
      label, groupId, lineId: null, incomeKind: direction === "in" ? incomeKind : null,
    };
    startTransition(async () => {
      if (edit) await editTransaction(edit.id, form);
      else await addTransaction(form);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {edit ? (
          <Button variant="ghost" size="sm"><Pencil className="size-4" />Modifier</Button>
        ) : (
          <Button size="sm"><Plus className="size-4" />Ajouter une transaction</Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{edit ? "Modifier la transaction" : "Nouvelle transaction"}</SheetTitle>
          <SheetDescription>Saisie manuelle, en attente de synchronisation bancaire.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <label className="flex flex-col gap-1 text-sm">
            Compte
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setGroupId(null); }}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm">
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>

          <div className="flex gap-2">
            <Button type="button" variant={direction === "out" ? "default" : "outline"} size="sm"
              onClick={() => { setDirection("out"); setGroupId(null); }}>Sortie</Button>
            <Button type="button" variant={direction === "in" ? "default" : "outline"} size="sm"
              onClick={() => { setDirection("in"); setGroupId(null); }}>Entrée</Button>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Date
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Montant (€)
            <Input type="number" inputMode="decimal" min="0" step="0.01" placeholder="0,00"
              value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Libellé
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex. Rémunération juillet" />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Groupe
            <select value={groupId ?? ""} onChange={(e) => setGroupId(e.target.value ? Number(e.target.value) : null)}
              className="border-input bg-background h-9 rounded-md border px-3 text-sm">
              <option value="">Non catégorisé</option>
              {groupChoices.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>

          {direction === "in" && (
            <label className="flex flex-col gap-1 text-sm">
              Type de rémunération
              <select value={incomeKind} onChange={(e) => setIncomeKind(e.target.value as "principal" | "supplementary")}
                className="border-input bg-background h-9 rounded-md border px-3 text-sm">
                <option value="principal">Principale</option>
                <option value="supplementary">Supplémentaire</option>
              </select>
            </label>
          )}

          <Button onClick={submit} disabled={isPending || !accountId || !date || !amount}>
            {edit ? "Enregistrer" : "Ajouter"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
