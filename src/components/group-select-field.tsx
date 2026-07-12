"use client";
import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGroup } from "@/app/transactions/actions";

type LineOpt = { id: number; name: string };
type GroupOpt = { id: number; name: string; lines: LineOpt[] };

// Retrait des lignes sous leur groupe, avec des espaces insécables pour que le
// menu déroulant ne les collapse pas.
const INDENT = "   › ";

// Encodage de la valeur du select :
//   ""        = Automatique
//   "none"    = forcé non catégorisé
//   "g:<id>"  = groupe entier
//   "l:<id>"  = ligne précise d'un récurrent (implique son groupe parent)
function stateOf(groupId: number | null, lineId: number | null, excluded: boolean): string {
  if (excluded) return "none";
  if (lineId !== null) return `l:${lineId}`;
  if (groupId !== null) return `g:${groupId}`;
  return "";
}

export function GroupSelectField({
  txnId, groups, defaultGroupId, defaultLineId, excluded = false,
}: {
  txnId: string;
  groups: GroupOpt[];
  defaultGroupId: number | null;
  defaultLineId: number | null;
  excluded?: boolean;
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
  const server = stateOf(defaultGroupId, defaultLineId, excluded);
  const [value, setValue] = useState(server);
  const [prevServer, setPrevServer] = useState(server);
  if (server !== prevServer) {
    setPrevServer(server);
    setValue(server);
  }

  return (
    <select
      value={value}
      disabled={isPending}
      className="border-input bg-background h-9 rounded-md border px-3 text-sm disabled:opacity-60"
      onChange={(e) => {
        const v = e.currentTarget.value;
        setValue(v);
        let groupId: number | null = null;
        let lineId: number | null = null;
        const isExcluded = v === "none";
        if (v.startsWith("g:")) {
          groupId = Number.parseInt(v.slice(2), 10);
        } else if (v.startsWith("l:")) {
          lineId = Number.parseInt(v.slice(2), 10);
          groupId = parentOf.get(lineId) ?? null;
        }
        startTransition(async () => {
          // revalidatePath seul ne rafraîchit pas la vue courante après l'action ;
          // router.refresh() re-télécharge le rendu serveur de façon fiable.
          await setGroup(txnId, groupId, isExcluded, lineId);
          router.refresh();
        });
      }}
    >
      <option value="">Automatique</option>
      <option value="none">Non catégorisé</option>
      {groups.map((g) => (
        <Fragment key={g.id}>
          <option value={`g:${g.id}`}>{g.name}</option>
          {g.lines.map((l) => (
            <option key={l.id} value={`l:${l.id}`}>{INDENT + l.name}</option>
          ))}
        </Fragment>
      ))}
    </select>
  );
}
