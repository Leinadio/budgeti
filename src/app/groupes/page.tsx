import { db } from "../../db/index";
import { listGroups } from "../../db/repositories/groups";
import { listAccounts } from "../../db/repositories/accounts";
import { accountDisplayName } from "../../lib/account";
import { formatEur } from "../../lib/money";
import {
  addGroup, removeGroup, addGroupKeyword, addLine, removeLine,
} from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const selectClass = "border-input bg-background h-9 rounded-md border px-3 text-sm";

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
            <form action={addGroup} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-name" className="font-normal">Nom</Label>
                <Input id="grp-name" name="name" placeholder="Ex: Courses" required />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-account" className="font-normal">Compte</Label>
                <select id="grp-account" name="accountId" className={selectClass}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{accountDisplayName(a)}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-kind" className="font-normal">Type</Label>
                <select id="grp-kind" name="kind" className={selectClass}>
                  <option value="envelope">Enveloppe</option>
                  <option value="recurring">Récurrents</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-direction" className="font-normal">Sens</Label>
                <select id="grp-direction" name="direction" className={selectClass}>
                  <option value="out">Sortie</option>
                  <option value="in">Entrée</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="grp-amount" className="font-normal">Montant € (enveloppe)</Label>
                <Input id="grp-amount" type="number" name="monthlyAmount" step="0.01" placeholder="0.00" className="max-w-32" />
              </div>
              <Button type="submit" size="sm">Ajouter</Button>
            </form>
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
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>
                {g.name}{" "}
                <span className="text-muted-foreground text-sm font-normal">
                  {accountName(g.accountId)} · {g.direction === "in" ? "Entrée" : "Sortie"} · {g.kind === "envelope" ? "Enveloppe" : "Récurrents"}
                </span>
              </CardTitle>
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium">{formatEur(total)}</span>
                <form action={removeGroup}>
                  <input type="hidden" name="id" value={g.id} />
                  <Button type="submit" size="sm" variant="ghost">Supprimer</Button>
                </form>
              </span>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {g.kind === "envelope" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {g.keywords.length === 0 && (
                      <span className="text-muted-foreground text-sm">Aucun mot-clé.</span>
                    )}
                    {g.keywords.map((kw) => (
                      <span key={kw} className="text-sm">{kw}</span>
                    ))}
                  </div>
                  <form action={addGroupKeyword} className="flex items-end gap-2">
                    <input type="hidden" name="groupId" value={g.id} />
                    <div className="flex flex-col gap-1">
                      <Label className="font-normal">Mot-clé</Label>
                      <Input name="keyword" placeholder="Ex: CARREFOUR" required className="max-w-40" />
                    </div>
                    <Button type="submit" size="sm" variant="secondary">Ajouter le mot-clé</Button>
                  </form>
                </>
              ) : (
                <>
                  {g.lines.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-sm">
                      <span>
                        {l.name}
                        <span className="text-muted-foreground"> · {l.keyword} · le {l.day}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span>{formatEur(l.amount)}</span>
                        <form action={removeLine}>
                          <input type="hidden" name="id" value={l.id} />
                          <Button type="submit" size="sm" variant="ghost">×</Button>
                        </form>
                      </span>
                    </div>
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
                    <div className="flex flex-col gap-1">
                      <Label className="font-normal">Mot-clé</Label>
                      <Input name="keyword" placeholder="Ex: SPOTIFY" required className="max-w-40" />
                    </div>
                    <Button type="submit" size="sm" variant="secondary">Ajouter la ligne</Button>
                  </form>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
