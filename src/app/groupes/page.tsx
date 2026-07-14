import { db } from "../../db/index";
import { listGroups } from "../../db/repositories/groups";
import { listAccounts } from "../../db/repositories/accounts";
import { accountDisplayName } from "../../lib/account";
import { addLine } from "./actions";
import { NewGroupForm } from "@/components/new-group-form";
import { EditableGroupHeader, EditableLine } from "@/components/group-editors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default function GroupesPage() {
  const database = db();
  const accounts = listAccounts(database);
  const groups = listGroups(database);
  const accountName = (id: string) => {
    const a = accounts.find((acc) => acc.id === id);
    return a ? accountDisplayName(a) : id;
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Nouveau groupe</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Aucun compte. Synchronise d&apos;abord dans Réglages.
            </p>
          ) : (
            <NewGroupForm accounts={accounts.map((a) => ({ id: a.id, name: accountDisplayName(a) }))} />
          )}
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">Aucun groupe défini.</p>
          </CardContent>
        </Card>
      )}

      {groups.map((g) => {
        const total = g.kind === "envelope" ? (g.monthlyAmount ?? 0) : g.lines.reduce((s, l) => s + l.amount, 0);
        return (
          <Card key={g.id}>
            <CardHeader>
              <EditableGroupHeader
                group={{ id: g.id, name: g.name, direction: g.direction, kind: g.kind, monthlyAmount: g.monthlyAmount }}
                accountName={accountName(g.accountId)}
                total={total}
              />
            </CardHeader>
            {g.kind === "recurring" && (
              <CardContent className="flex flex-col gap-2">
                {g.lines.map((l) => (
                  <EditableLine key={l.id} line={l} />
                ))}
                <form action={addLine} className="flex flex-wrap items-end gap-2 pt-2">
                  <input type="hidden" name="groupId" value={g.id} />
                  <div className="flex flex-col gap-1">
                    <Label className="font-normal">Nom</Label>
                    <Input name="name" placeholder="Ex: Spotify" required className="max-w-40" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="font-normal">Montant €</Label>
                    <Input type="number" name="amount" step="0.01" placeholder="0.00" className="max-w-28" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="font-normal">Jour</Label>
                    <Input type="number" name="day" min="1" max="31" placeholder="1-31" className="max-w-24" required />
                  </div>
                  <Button type="submit" size="sm" variant="secondary">Ajouter la ligne</Button>
                </form>
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
