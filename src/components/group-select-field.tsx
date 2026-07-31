"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGroup } from "@/app/transactions/actions";
import { cn } from "@/lib/utils";

type LineOpt = { id: number; name: string };
type GroupOpt = { id: number; name: string; kind: "envelope" | "recurring"; lines: LineOpt[] };

// Retrait des lignes sous leur groupe, avec des espaces insécables pour que le
// menu déroulant ne les collapse pas.
const INDENT = "   › ";

// Encodage de la valeur du select (rattachement 100 % manuel) :
//   ""        = non catégorisé (aucun groupe)
//   "g:<id>"  = groupe entier
//   "l:<id>"  = ligne précise d'un récurrent (implique son groupe parent)
function stateOf(groupId: number | null, lineId: number | null): string {
  if (lineId !== null) return `l:${lineId}`;
  if (groupId !== null) return `g:${groupId}`;
  return "";
}

export function GroupSelectField({
  txnId, groups, defaultGroupId, defaultLineId, disabled = false, className,
}: {
  txnId: string;
  groups: GroupOpt[];
  defaultGroupId: number | null;
  defaultLineId: number | null;
  disabled?: boolean;
  // Ajusté par l'appelant quand le menu partage sa place (colonne étroite du
  // tableau de l'historique, où il doit pouvoir rétrécir).
  className?: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  // ligne -> groupe parent, pour retrouver le group_id quand on choisit une ligne.
  const parentOf = useMemo(() => {
    const m = new Map<number, number>();
    for (const g of groups) for (const l of g.lines) m.set(l.id, g.id);
    return m;
  }, [groups]);

  // Affiche tout de suite le choix (valeur optimiste), puis suit la vérité
  // serveur : quand l'état serveur change après le refresh, on se resynchronise.
  const server = stateOf(defaultGroupId, defaultLineId);
  const [value, setValue] = useState(server);
  const [prevServer, setPrevServer] = useState(server);
  if (server !== prevServer) {
    setPrevServer(server);
    setValue(server);
  }

  return (
    <select
      value={value}
      disabled={disabled || isPending}
      className={cn("border-input bg-background h-9 rounded-md border px-3 text-sm disabled:opacity-60", className)}
      onChange={(e) => {
        const v = e.currentTarget.value;
        setValue(v);
        let groupId: number | null = null;
        let lineId: number | null = null;
        if (v.startsWith("g:")) {
          groupId = Number.parseInt(v.slice(2), 10);
        } else if (v.startsWith("l:")) {
          lineId = Number.parseInt(v.slice(2), 10);
          groupId = parentOf.get(lineId) ?? null;
        }
        startTransition(async () => {
          // revalidatePath seul ne rafraîchit pas la vue courante après l'action ;
          // router.refresh() re-télécharge le rendu serveur de façon fiable.
          await setGroup(txnId, groupId, lineId);
          router.refresh();
        });
      }}
    >
      <option value="">Non catégorisé</option>
      {groups.map((g) =>
        // Un récurrent n'est pas une destination : ses dépenses appartiennent à une de
        // ses lignes (Direct Assurance, Sosh Internet…), jamais au groupe lui-même. Son
        // nom reste affiché, mais comme un titre non sélectionnable — d'où optgroup,
        // qui dit exactement ça au navigateur comme aux lecteurs d'écran.
        g.kind === "recurring" ? (
          <optgroup key={g.id} label={g.name}>
            {g.lines.map((l) => (
              <option key={l.id} value={`l:${l.id}`}>{l.name}</option>
            ))}
          </optgroup>
        ) : (
          <Fragment key={g.id}>
            <option value={`g:${g.id}`}>{g.name}</option>
            {g.lines.map((l) => (
              <option key={l.id} value={`l:${l.id}`}>{INDENT + l.name}</option>
            ))}
          </Fragment>
        ),
      )}
    </select>
  );
}
