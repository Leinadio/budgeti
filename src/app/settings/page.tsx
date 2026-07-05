import { db } from "../../db/index";
import { getSetting } from "../../db/repositories/settings";
import { listAccounts } from "../../db/repositories/accounts";
import { saveThreshold } from "./actions";
import { ConnectButtons } from "./ConnectButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 3600 * 1000));
}

export default function SettingsPage() {
  const database = db();
  const validUntil = getSetting(database, "consent_valid_until");
  const days = daysUntil(validUntil);
  const threshold = getSetting(database, "balance_threshold") ?? "";
  const accounts = listAccounts(database);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Connexion bancaire</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ConnectButtons />
          {days !== null && (
            <Badge variant={days < 7 ? "destructive" : "secondary"}>
              Reconnexion à CIC nécessaire dans {days} jour(s).
            </Badge>
          )}
          {accounts.length > 0 && (
            <ul className="text-muted-foreground list-inside list-disc text-sm">
              {accounts.map((a) => (
                <li key={a.id}>
                  {a.name} — dernière synchro : {a.last_synced ?? "jamais"}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seuil d'alerte de solde</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveThreshold} className="flex items-center gap-2">
            <Input
              type="number"
              name="threshold"
              step="0.01"
              defaultValue={threshold}
              placeholder="ex. 200"
              className="max-w-40"
            />
            <Button type="submit" size="sm">
              Enregistrer
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
