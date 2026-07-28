// Synchronisation entre le side panel et le tableau de l'Historique. Deux besoins,
// tous deux purement calculatoires :
//   - révéler dans le tableau une ligne masquée (transaction, poste d'un récurrent)
//     quand on la choisit dans le panneau : quels dépliages faut-il ouvrir ;
//   - savoir vers quelle case renvoie le « Solde précédent » d'une ligne, en sautant
//     les cases laissées vides parce que la ligne n'a rien bougé.
import type { HistorySection, SoldeColumn, PlannedSoldes } from "./history";
import { openingRow, groupRow, subRow, txnRow, type DetailNode, type CellDetail } from "./history-explain";
import { sectionRowKey } from "./history-detail";

// Clés de dépliage du tableau (état `open` de la grille). Distinctes des clés de
// LIGNE (group:…, subrow:…) : un même groupe a les deux, l'une pour son dépliage,
// l'autre pour repérer ses cases.
export const rowOpenKey = (groupId: number) => `g:${groupId}`;
export const lineOpenKey = (lineId: number) => `l:${lineId}`;
export const uncatOpenKey = (direction: "in" | "out") => (direction === "in" ? "s:uncat-in" : "s:uncat");

// Pour chaque ligne masquable (transaction, sous-ligne d'un récurrent) : clés de
// dépliage de ses ancêtres (groupe, et éventuelle ligne), afin de la révéler dans
// le tableau quand on la sélectionne depuis le side panel.
export function computeRevealKeys(sections: HistorySection[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const sec of sections) {
    if (sec.kind === "uncategorized") {
      const k = uncatOpenKey(sec.uncatDirection ?? "out");
      for (const t of sec.txns ?? []) m.set(txnRow(t.id), [k]);
    } else {
      for (const r of sec.rows) {
        for (const t of r.txns) m.set(txnRow(t.id), [rowOpenKey(r.id)]);
        for (const sub of r.subRows) {
          m.set(subRow(sub.id), [rowOpenKey(r.id)]);
          for (const t of sub.txns) m.set(txnRow(t.id), [rowOpenKey(r.id), lineOpenKey(sub.id)]);
        }
      }
    }
  }
  return m;
}

// Une étape de la colonne : la ligne du tableau et ses trois valeurs courues.
type Stop = { key: string; solde: (number | null)[]; prevu: (number | null)[]; depass: (number | null)[] };

export type PrevDisplayed = {
  solde: Map<string, (string | undefined)[]>;
  soldePrevu: Map<string, (string | undefined)[]>;
  soldeDepass: Map<string, (string | undefined)[]>;
};

// « Solde précédent » d'une ligne, par COLONNE de solde et par mois : la clé de la
// dernière ligne AFFICHÉE (non vide) au-dessus, dans cette colonne. Les cases à
// mouvement nul sont vides (cf. soldeWithSign) ; on les saute pour pointer la
// dernière valeur réellement montrée, pas une case vide. Une case est « affichée »
// quand sa valeur diffère de celle de la ligne du dessus (= mouvement non nul, même
// règle que soldeWithSign). L'« Argent de départ » est toujours affiché : repli ultime.
export function computePrevDisplayed(
  sections: HistorySection[],
  months: string[],
  currentMonth: string,
  solde: SoldeColumn,
  planned: PlannedSoldes,
): PrevDisplayed {
  const n = months.length;
  const nulls = new Array<number | null>(n).fill(null);
  const stops: Stop[] = [
    {
      key: openingRow,
      solde: solde.openings,
      // Ouverture prévu / si dépassement : le plan s'ancre sur l'ouverture réelle sur
      // passé/courant ; sur le futur, repli sur la clôture précédente (approximation
      // suffisante — l'ouverture est de toute façon toujours affichée).
      prevu: months.map((mo, i) => (mo <= currentMonth ? solde.openings[i] : planned.prevuClosings[i - 1] ?? solde.openings[i])),
      depass: months.map((mo, i) => (mo <= currentMonth ? solde.openings[i] : planned.depassClosings[i - 1] ?? solde.openings[i])),
    },
  ];
  for (const sec of sections) {
    if (sec.kind === "uncategorized") {
      const dir = sec.uncatDirection ?? "out";
      stops.push({
        key: sectionRowKey(sec),
        solde: solde.uncategorizedRunning?.[dir] ?? nulls,
        prevu: planned.uncatPrevuRunning?.[dir] ?? nulls,
        depass: planned.uncatDepassRunning?.[dir] ?? nulls,
      });
    } else {
      for (const r of sec.rows) {
        stops.push({
          key: groupRow(r.id),
          solde: solde.rowRunning[r.id] ?? nulls,
          prevu: planned.prevuRowRunning[r.id] ?? nulls,
          depass: planned.depassRowRunning[r.id] ?? nulls,
        });
      }
    }
  }

  const build = (pick: (s: Stop) => (number | null)[]) => {
    const map = new Map<string, (string | undefined)[]>();
    for (let k = 0; k < stops.length; k++) {
      const arr = new Array<string | undefined>(n).fill(undefined);
      for (let i = 0; i < n; i++) {
        let j = k - 1;
        while (j > 0) {
          const vj = pick(stops[j])[i];
          const vjm1 = pick(stops[j - 1])[i];
          // Étape affichée si sa valeur diffère de celle du dessus (mouvement non nul).
          if (vj == null || vjm1 == null || Math.abs(vj - vjm1) >= 0.005) break;
          j--;
        }
        arr[i] = j >= 0 ? stops[j].key : undefined;
      }
      map.set(stops[k].key, arr);
    }
    return map;
  };

  return {
    solde: build((s) => s.solde),
    soldePrevu: build((s) => s.prevu),
    soldeDepass: build((s) => s.depass),
  };
}

// --- La chaîne du clic dans le side panel ------------------------------------
// Cliquer une ligne du panneau allume une ou plusieurs cases du tableau, et peut
// avoir à déplier des lignes repliées pour les rendre visibles. Ces règles sont
// posées ici, hors des composants, pour être vérifiables.

// Identité de la ligne « Total » du panneau. Distincte des chemins de nœuds
// (« 0 », « 1.2 ») : cliquer une ligne intermédiaire qui vise la même case du
// tableau ne doit pas activer aussi le Total.
export const TOTAL_ROW = "__total__";

// Une ligne du panneau, telle qu'affichée : le nœud, son chemin (son identité),
// son retrait, et son état de dépliage.
export type PanelRow = {
  node: DetailNode;
  label: string;
  path: string;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

// Aplatit l'arbre de nœuds en lignes, en ne gardant que les enfants des nœuds
// dépliés (open). depth pilote le retrait ; path identifie la ligne.
export function flattenNodes(nodes: DetailNode[], open: ReadonlySet<string>, depth = 0, prefix = ""): PanelRow[] {
  const out: PanelRow[] = [];
  nodes.forEach((n, i) => {
    const path = prefix ? `${prefix}.${i}` : `${i}`;
    const hasChildren = !!n.children && n.children.length > 0;
    const expanded = hasChildren && open.has(path);
    out.push({ node: n, label: n.label, path, depth, hasChildren, expanded });
    if (expanded) out.push(...flattenNodes(n.children!, open, depth + 1, path));
  });
  return out;
}

// Cases du tableau à allumer quand on clique une ligne du panneau : ses cases
// dédiées (refs) si son montant est une somme éclatée dans le tableau, sinon sa
// case (ref), sinon la case d'origine du détail (celle dont on montre le calcul).
export function cellsForNode(node: DetailNode, detailCellRef?: string): string[] | null {
  if (node.refs) return node.refs;
  if (node.ref) return [node.ref];
  return detailCellRef ? [detailCellRef] : null;
}

// La ligne « Total » vaut la case qui a ouvert le calcul.
export function cellsForTotal(detail: CellDetail): string[] | null {
  return detail.cellRef ? [detail.cellRef] : null;
}

// Cases allumées dans le tableau : l'ancre (le montant cliqué dans le tableau, qui
// reste allumé tant que le panneau est ouvert) ET les cases choisies dans le panneau.
export function highlightedCells(anchor: string | null, selected: string[] | null): Set<string> {
  return new Set([anchor, ...(selected ?? [])].filter((k): k is string => k != null));
}

// Ligne porteuse d'une case : préfixe de la clé « <ligne>::colonne::mois ».
// null si aucune case active, ou si la clé n'en est pas une.
export function rowKeyOf(cell: string | null): string | null {
  if (!cell) return null;
  const i = cell.indexOf("::");
  return i > 0 ? cell.slice(0, i) : null;
}

// Dépliage effectif = celui de l'utilisateur, plus les ancêtres de la ligne
// sélectionnée, afin de la révéler sans muter l'état de dépliage manuel. Rend
// l'ensemble d'origine (même référence) quand il n'y a rien à ajouter.
export function withRevealed(
  open: Set<string>,
  selRowKey: string | null,
  revealKeys: Map<string, string[]>,
): Set<string> {
  if (!selRowKey) return open;
  const keys = revealKeys.get(selRowKey);
  if (!keys || keys.every((k) => open.has(k))) return open;
  const next = new Set(open);
  for (const k of keys) next.add(k);
  return next;
}

// État de sélection du panneau : l'ancre (montant cliqué dans le tableau), les
// cases allumées depuis le panneau, et l'identité de la ligne active du panneau.
export type PanelSelection = { anchor: string | null; selected: string[] | null; panel: string | null };

// Ouvrir un détail : le montant cliqué devient l'ancre, la sélection repart à zéro.
// Fermer (detail = null) éteint tout.
export function selectionForDetail(detail: CellDetail | null): PanelSelection {
  return { anchor: detail?.cellRef ?? null, selected: null, panel: null };
}

// Cliquer une ligne du panneau : l'ancre survit, la sélection est remplacée.
export function selectionForRow(current: PanelSelection, cells: string[] | null, panel: string): PanelSelection {
  return { anchor: current.anchor, selected: cells, panel };
}
