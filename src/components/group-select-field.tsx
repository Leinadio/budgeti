"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGroup } from "@/app/transactions/actions";
import { groupSelectSections } from "@/lib/group-select-options";
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
  const sections = useMemo(() => groupSelectSections(groups), [groups]);

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
      {/* Deux sections nommées, « Récurrents » puis « Enveloppes » comme dans le
          tableau : l'optgroup met son titre en gras et décale ce qu'il contient,
          si bien que la nature d'un choix se voit avant de le lire. */}
      {sections.map((sec) => (
        <optgroup key={sec.label} label={sec.label}>
          {sec.items.map((item) =>
            item.type === "line" ? (
              <option key={`l:${item.id}`} value={`l:${item.id}`}>{INDENT + item.name}</option>
            ) : item.selectable ? (
              <option key={`g:${item.id}`} value={`g:${item.id}`}>{item.name}</option>
            ) : (
              // Un récurrent n'est pas une destination : ses dépenses appartiennent à
              // une de ses lignes (Sosh Internet, Sosh Mobile…), jamais au groupe.
              // Son nom reste affiché, en titre inerte, pour qu'on voie à qui
              // appartiennent les lignes juste en dessous. La valeur « t: » ne
              // correspond à aucun état possible : l'option ne peut pas être choisie
              // et ne se confond pas avec « Non catégorisé », dont la valeur est vide.
              <option key={`t:${item.id}`} value={`t:${item.id}`} disabled>{item.name}</option>
            ),
          )}
        </optgroup>
      ))}
    </select>
  );
}
