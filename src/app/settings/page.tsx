import { db } from "../../db/index";
import { getSetting } from "../../db/repositories/settings";
import { listAccounts } from "../../db/repositories/accounts";
import { saveThreshold } from "./actions";
import { ConnectButtons } from "./ConnectButtons";

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
    <div>
      <div className="card">
        <h2>Connexion bancaire</h2>
        <ConnectButtons />
        {days !== null && (
          <p className={days < 7 ? "alert danger" : ""}>
            Reconnexion à CIC nécessaire dans {days} jour(s).
          </p>
        )}
        {accounts.length > 0 && (
          <ul>{accounts.map((a) => <li key={a.id}>{a.name} — dernière synchro : {a.last_synced ?? "jamais"}</li>)}</ul>
        )}
      </div>

      <div className="card">
        <h2>Seuil d'alerte de solde</h2>
        <form action={saveThreshold} style={{ display: "flex", gap: ".5rem" }}>
          <input type="number" name="threshold" step="0.01" defaultValue={threshold} placeholder="ex. 200" />
          <button type="submit">Enregistrer</button>
        </form>
      </div>
    </div>
  );
}
