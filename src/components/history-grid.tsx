"use client";
import { Fragment, cloneElement, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight, Plus, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/transactions-view";
import type { AccountForecast } from "@/lib/forecast";
import { type MonthCell, type HistorySection, type HistoryRow, type HistorySubRow, type HistoryTxn, type SoldeColumn, type PlannedSoldes, type Overspend, type IgnoredBlock, uncatOverspend, uncatOverspendOf, computeTableEstimate, rowRevenus, rowOverspend, groupsWithPending } from "@/lib/history";
import { sectionsAtMonth } from "@/lib/history-month-view";
import { notificationId } from "@/lib/notifications";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/truncated-text";
import { TxnCommentField } from "@/components/txn-comment-field";
import { GroupSelectField } from "@/components/group-select-field";
import { IgnoreTxnToggle } from "@/components/ignore-txn-toggle";
import { NewGroupInline } from "@/components/new-group-inline";
import { NewRemunerationInline } from "@/components/new-remuneration-inline";
import { type ColKey, monthType, monthColumns, COL_LABEL, COL_INFO, budgetChangePoints } from "@/lib/history-columns";
import { computeRevealKeys, computePrevDisplayed, rowOpenKey, lineOpenKey, uncatOpenKey, highlightedCells, rowKeyOf, withRevealed } from "@/lib/history-nav";
import {
  netCol,
  txnChildren,
  budgetNodes,
  groupNode,
  negateNode,
  sectionRowKey,
  labelOfSection,
  uncatTxnNodes,
  sectionTxnChildren,
  sectionNode,
  soldeActuelDetail,
  budgetEditOfGroup,
  budgetEditOfLine,
} from "@/lib/history-detail";
import {
  type CellDetail,
  type DetailNode,
  type Col,
  type BudgetEditInfo,
  type OverspendNoticeInfo,
  cellKey,
  openingRow,
  sectionRow,
  groupRow,
  subRow,
  txnRow,
  makeDetail,
  makeInfo,
  txnNode,
} from "@/lib/history-explain";
import { type BudgetChange } from "@/lib/budget-history";

// Décision déjà prise sur un dépassement (groupId, mois), telle que chargée en page
// (Task 4). groupId = 0 pour les non catégorisés.

// Groupes du compte, pour le menu de (ré)assignation sur chaque transaction et la
// gestion d'un groupe (Task 6 : kind + lignes complètes pour alimenter le side panel).
type SelectGroup = {
  id: number;
  name: string;
  kind: "envelope" | "recurring";
  changes: BudgetChange[];
  lines: { id: number; name: string; amount: number; day: number; changes: BudgetChange[] }[];
};
const MUTED40 = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";
// Surbrillance de la case sélectionnée depuis le side panel : fond teinté + anneau.
const CELL_HL = "bg-[color-mix(in_oklab,var(--primary)_22%,var(--background))] ring-1 ring-inset ring-primary/60";

// « 2026-07 » → « Juillet ». L'année est affichée à part dans l'en-tête, en
// chasse fixe et en retrait, pour que le nom du mois porte seul le titre.
function monthName(ym: string): string {
  const s = monthLabel(ym);
  return s.replace(/\s+\d{4}$/, "");
}

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : n).replace(/[  ]/g, " ");

// Couleur d'un montant « Reste/Manque » : rouge s'il manque (négatif), vert sinon
// (reste positif ou à zéro).
function resteColor(v: number): string {
  return v < -0.005 ? "text-red-600" : "text-green-600";
}

// Couleur d'une case des trois colonnes de solde, dictée par ce qui est écrit
// DEVANT le montant. Une ligne d'opération porte un opérateur (cf. soldeWithSign) :
// « − » en rouge, « + » en vert. Une ligne de départ ou de résultat n'a pas
// d'opérateur : seul le signe du montant compte, donc rouge s'il est négatif et
// noir sinon. Un montant sans rien devant reste toujours noir.
function soldeColor(v: number | null | undefined, delta?: number | null): string | undefined {
  if (v == null) return undefined;
  if (delta != null) {
    if (Math.abs(delta) < 0.005) return undefined; // mouvement nul : cellule vide
    return delta > 0 ? "text-green-600" : "text-red-600";
  }
  return v < -0.005 ? "text-red-600" : undefined;
}

// Étiquette posée sous un montant de Balance en dépassement. Un simple constat : la
// dépense a dépassé le budget de ce mois-là. Rien à trancher, rien à décider — relever
// un budget pour la suite se fait à la main, dans les cases des mois concernés.
//
// En bloc à part sous le montant plutôt qu'à côté : la colonne est étroite, et une
// étiquette sur la même ligne la ferait s'élargir pour tout le tableau. Ainsi seule la
// hauteur de la ligne augmente, et uniquement là où il y a un dépassement.
function OverspendTag() {
  return (
    <span
      title="La dépense a dépassé le budget de ce mois."
      className="inline-block rounded-[3px] border border-amber-300 bg-amber-50 px-1 py-px font-sans text-[9px] leading-[1.5] font-semibold tracking-[0.06em] text-amber-800 uppercase dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200"
    >
      dépassement
    </span>
  );
}

// Largeur fixe de la première colonne. Un conteneur interne à largeur px fixe
// (et non un max-width sur la cellule, ignoré en table-auto) garantit que la
// colonne ne bouge pas quand on déroule des transactions à long libellé.
const COL1_W = 320;

// Le modèle de colonnes (quelles colonnes sous quel mois, leur libellé et leur
// explication) vit dans src/lib/history-columns.ts : c'est une règle, pas du rendu.


// Colonnes de solde (cumulé, se traîne de mois en mois). Chacune porte SA teinte,
// pour qu'on distingue les trois chaînes d'un coup d'œil sans relire l'en-tête :
// bleu-vert pour le réel (le certain), indigo pour le prévu (le plan), rosé pour le
// plan mis à l'épreuve. Chromas faibles pour que les montants rouges et verts
// restent lisibles par-dessus, et teintes distinctes de l'ambré de la Balance.
// Comme BALANCE_TINT, elles sont posées sur CHAQUE cellule (via renderCols) et
// passent donc au-dessus de la teinte du mois.
const SOLDE_TINTS: Partial<Record<ColKey, string>> = {
  soldeReel: "bg-[color-mix(in_oklab,oklch(0.75_0.10_210)_15%,var(--background))]",
  soldePrevu: "bg-[color-mix(in_oklab,oklch(0.70_0.10_285)_15%,var(--background))]",
  soldeDepass: "bg-[color-mix(in_oklab,oklch(0.72_0.08_340)_15%,var(--background))]",
};
// Teinte de fond de la colonne Balance (ex-« Reste/Manque ») : un ambré doux qui
// la distingue de la bande grise des soldes. Posée sur CHAQUE cellule Balance (via
// renderCols), pas sur le <colgroup>, pour rester visible même sous un fond de
// ligne opaque (totaux gris, teinte entrant/sortant).
// Séparation entre deux mois : un filet vertical plus du blanc tournant, posés sur
// la première colonne de chaque mois. Surtout PAS une bande épaisse peinte à la
// couleur du fond : elle perçait les fonds de ligne et coupait les filets
// horizontaux, et comme elle défile avec les colonnes, ça donnait un trou mobile
// qui faisait passer le tableau « en dessous ». Ici la ligne reste continue d'un
// bout à l'autre ; ce sont la teinte du mois et le filet qui détachent les blocs.
// Ça évite aussi d'insérer une colonne de séparation dans toute la structure du
// tableau (colgroup, deux rangées d'en-tête, chaque constructeur de ligne, totalCols).
const MONTH_GAP = "border-l border-l-border/70 pl-5";

const BALANCE_TINT = "bg-[color-mix(in_oklab,oklch(0.75_0.16_80)_16%,var(--background))]";

// Teinte de fond du bloc sortant (Récurrents, Enveloppes) : très légère, juste de
// quoi séparer visuellement ce bloc du bloc entrant (Rémunérations) au-dessus,
// sans gêner la lecture des montants rouges/verts. Posée uniquement sur les
// lignes de groupe et les sous-totaux de section qui n'ont pas déjà de fond
// (les bandes grises « Total … » gardent leur teinte existante, déjà assez
// marquée pour se distinguer).
const OUT_TINT = "bg-[color-mix(in_oklab,var(--muted)_12%,var(--background))]";

// Teinte de fond selon la NATURE du mois, posée sur tout le bloc du mois via le
// <colgroup>. Comme les autres teintes de colonne, elle passe sous les fonds de
// ligne opaques (totaux gris, teintes entrant/sortant) : elle colore donc surtout
// les cellules de données et l'en-tête du mois. Gris = mois passés, bleu doux =
// mois courant, vert doux = premier mois futur (le « pont » qui repart de l'estimé
// de fin du mois courant). Les mois futurs suivants (N+2, …) restent neutres.
const MONTH_TINT_PAST = "bg-[color-mix(in_oklab,oklch(0.6_0.03_255)_22%,var(--background))]";
const MONTH_TINT_CURRENT = "bg-[color-mix(in_oklab,oklch(0.72_0.13_240)_14%,var(--background))]";
const MONTH_TINT_NEXT = "bg-[color-mix(in_oklab,oklch(0.75_0.14_155)_15%,var(--background))]";
function monthTint(m: string, mi: number, months: string[], currentMonth: string): string | undefined {
  if (m < currentMonth) return MONTH_TINT_PAST;
  if (m === currentMonth) return MONTH_TINT_CURRENT;
  if (mi > 0 && months[mi - 1] === currentMonth) return MONTH_TINT_NEXT; // premier mois futur (N+1)
  return undefined; // mois futurs suivants : fond par défaut
}

// Rend les cellules d'un mois (une par colonne). `tint` est la teinte de fond selon
// la nature du mois (passé / courant / premier mois futur) : on la pose en BASE de
// CHAQUE cellule pour qu'elle couvre tout le bloc du mois, y compris sous les lignes
// de total grises (le fond d'une cellule recouvre celui de sa ligne). La Balance et
// les trois colonnes de solde gardent leur teinte propre par-dessus, et les mois sans
// teinte (undefined) restent neutres.
// Une cellule de tableau, avec sa className : le type dit ce que renderCols exige
// pour pouvoir y poser la teinte du mois, au lieu de le supposer par un cast.
type ColCell = React.ReactElement<{ className?: string }>;
// Un jeu de slots : une fonction de rendu par colonne, qui reçoit « est-ce la
// première colonne du mois » (bordure de séparation).
export type ColSlots = Record<ColKey, (border: boolean) => ColCell>;

function renderCols(cols: ColKey[], slots: ColSlots, tint?: string): React.ReactNode[] {
  return cols.map((col, idx) => {
    const cell = slots[col](idx === 0);
    // Base de cellule, posée AVANT sa className propre pour que la surbrillance de
    // sélection (CELL_HL) reste au-dessus.
    const base = col === "reste" ? BALANCE_TINT : SOLDE_TINTS[col] ?? tint;
    if (!base) return cell;
    return cloneElement(cell, { className: cn(base, cell.props.className) });
  });
}

// Cellule vide (colonne non renseignée pour cette ligne), avec bordure de mois si
// c'est la première colonne du mois.
function blankCol(key: string, border: boolean): ColCell {
  return <TableCell key={key} className={cn(border && MONTH_GAP)} />;
}

// Cellule de solde « plan » (prévu / si dépassement) : affichage simple, non
// cliquable, rouge si négatif ; vide si la valeur est nulle (mois avant le courant).
function plannedSoldeCol(key: string, val: number | null | undefined, border: boolean): ColCell {
  return (
    <TableCell key={key} className={cn(border && MONTH_GAP, "text-right tabular-nums", soldeColor(val))}>
      {val != null ? fmt(val) : ""}
    </TableCell>
  );
}

// Jeu de slots (une fonction de rendu par colonne) toutes vides : sert de base aux
// lignes qui ne renseignent qu'une ou deux colonnes (ouverture, lignes du bas).
function blankSlots(): ColSlots {
  return {
    budgetRem: (b) => blankCol("budgetRem", b),
    budgetDep: (b) => blankCol("budgetDep", b),
    dep: (b) => blankCol("dep", b),
    recu: (b) => blankCol("recu", b),
    reste: (b) => blankCol("reste", b),
    soldeReel: (b) => blankCol("soldeReel", b),
    soldePrevu: (b) => blankCol("soldePrevu", b),
    soldeDepass: (b) => blankCol("soldeDepass", b),
  };
}

// Boîte à largeur fixe placée dans la cellule de gauche. Le retrait (indent) est
// appliqué à l'intérieur, donc toutes les cellules gardent la même largeur.
// Filet à droite de la colonne figée : quand le tableau défile horizontalement,
// les mois passent DERRIÈRE cette colonne. Sans séparation, les libellés et les
// chiffres semblent se toucher.
// h-full ne suffit pas seul : dans un <td>, un pourcentage de hauteur se résout
// contre la hauteur INTRINSÈQUE de la cellule, pas contre celle que la ligne lui
// impose. Sur une ligne étirée par une autre colonne (une Balance qui porte son
// étiquette sous le montant), la boîte restait à sa hauteur naturelle et le filet
// s'arrêtait avant le bas — d'où le bout clair au coin. Les cellules de cette
// colonne portent donc `h-px` : la hauteur déclarée rend le 100 % résoluble, et la
// ligne étire la cellule de toute façon puisqu'elle ne peut pas être plus petite
// que son contenu.
function FirstColBox({ children, indent = 0 }: { children: React.ReactNode; indent?: number }) {
  return (
    <div
      className="border-border/60 flex h-full items-center gap-1.5 overflow-hidden border-r py-2 pr-2 font-sans"
      style={{ width: COL1_W, paddingLeft: `${0.5 + indent * 1.25}rem` }}
    >
      {children}
    </div>
  );
}

// Cellule de montant : cliquable (sélection → sidebar) si un détail est fourni.
// cellKey (data-cellkey) identifie la case pour la surbrillance croisée et le
// défilement depuis le side panel ; elle s'allume quand elle est la case sélectionnée.
function CellAmount({ children, className, detail, onSelect, cellKey: ck, selCellKey }: {
  children: React.ReactNode;
  className?: string;
  detail?: CellDetail | null;
  onSelect?: (d: CellDetail) => void;
  cellKey?: string;
  selCellKey?: ReadonlySet<string>;
}) {
  const cls = cn(className, ck != null && selCellKey?.has(ck) && CELL_HL);
  if (!detail || !onSelect) return <TableCell data-cellkey={ck} className={cls}>{children}</TableCell>;
  // On rattache la clé de cette case au détail (cellRef), pour pouvoir la surligner
  // depuis la ligne « Total » du side panel.
  return (
    <TableCell data-cellkey={ck} className={cls}>
      <button
        type="button"
        onClick={() => onSelect(ck != null ? { ...detail, cellRef: ck } : detail)}
        className="cursor-pointer decoration-dotted underline-offset-2 hover:underline"
      >
        {children}
      </button>
    </TableCell>
  );
}

// Cellule de solde « plan » (prévu / si dépassement) cliquable : comme
// Solde avec son signe d'opération : « + » si la ligne a fait monter le solde par
// rapport à la ligne du dessus, « − » si elle l'a fait baisser, suivi du montant en
// VALEUR ABSOLUE (le rouge de la cellule indique déjà le négatif — jamais de double
// signe « − -39,73 »). Fait lire la colonne comme un calcul qui s'enchaîne de haut
// en bas. Si la ligne n'a rien changé (mouvement nul), la cellule reste vide : seules
// les lignes qui « opèrent » sur le solde s'affichent.
function soldeWithSign(v: number, delta: number | null | undefined): React.ReactNode {
  // Aucun mouvement fourni (ligne de départ / total) : on affiche toujours le solde,
  // signé, sans opérateur — ce ne sont pas des « opérations » mais des points de
  // départ / résultats.
  if (delta == null) return fmt(v);
  // Mouvement fourni mais nul : la ligne n'a rien changé, cellule vide.
  if (Math.abs(delta) < 0.005) return null;
  return (
    <>
      <span className="text-muted-foreground">{delta > 0 ? "+" : "−"} </span>
      {fmt(Math.abs(v))}
    </>
  );
}

// plannedSoldeCol mais avec un détail (sidebar) et une clé de case. Non cliquable
// si la valeur est absente (cellule vide). `delta` = mouvement de la ligne, pour le
// signe d'opération (cf. soldeWithSign) ; absent = pas de signe (départ/total).
function plannedSoldeCell(
  key: string,
  val: number | null | undefined,
  border: boolean,
  detail: CellDetail | null,
  onSelect: ((d: CellDetail) => void) | undefined,
  ck: string,
  selCellKey?: ReadonlySet<string>,
  delta?: number | null,
): ColCell {
  return (
    <CellAmount
      key={key}
      className={cn(border && MONTH_GAP, "text-right tabular-nums", soldeColor(val, delta))}
      detail={val != null ? detail : null}
      onSelect={onSelect}
      cellKey={ck}
      selCellKey={selCellKey}
    >
      {val != null ? soldeWithSign(val, delta) : ""}
    </CellAmount>
  );
}

// mode : "out" (dépense), "in" (entrée) ou "total" (sous-total, montre les deux
// colonnes). La colonne Solde affiche le solde du compte cumulé, fourni par
// `solde` (une valeur par mois) ; absente ou null => cellule vide.
// detailRow : ligne de groupe (transactions/postes) permettant de construire le
// détail cliquable des cellules. Absente pour les sous-lignes (postes d'un
// récurrent) : ces cellules restent non cliquables (hors périmètre, cf. ci-dessous).
// Index du seul mois à rendre. L'Historique affiche un tableau par mois, mais les
// données restent indexées sur la frise entière : chaque composant reçoit donc
// toujours tous les mois et n'en dessine qu'un. C'est ce qui garde intactes les
// clés de case (« ligne::colonne::index de mois »), donc la sélection, les renvois
// du panneau de détail et le défilement vers une case — tout est repéré par cet
// index. Absent, tous les mois sont rendus (comportement d'origine).
type OnlyMonth = { only?: number };
const skipMonth = (only: number | undefined, i: number) => only != null && i !== only;

function AmountCells({ cells, mode, solde, soldePrevu, soldeDepass, onSelect, subtitleOf, detailRow, months, currentMonth, rowKey, selCellKey, prevDisp, incomeKind, budgetEditOf, signaleDepassement, noticeOf, only }: OnlyMonth & {
  cells: MonthCell[];
  mode: "out" | "in" | "total";
  solde?: (number | null)[];
  // Chaînes de solde « plan » de cette ligne (prévu / si dépassement), une valeur
  // par mois, nulles avant le mois courant. Absentes pour les sous-lignes.
  soldePrevu?: (number | null)[];
  soldeDepass?: (number | null)[];
  onSelect?: (d: CellDetail) => void;
  subtitleOf?: (i: number) => string;
  detailRow?: HistoryRow;
  months: string[];
  currentMonth: string;
  // Clé de ligne de ces cellules (group:… ou subrow:…), pour composer les data-cellkey.
  rowKey: string;
  // Case sélectionnée depuis le side panel (pour la surbrillance).
  selCellKey?: ReadonlySet<string>;
  // Clé de la dernière ligne AFFICHÉE au-dessus, par colonne de solde et par mois
  // (les cases vides à mouvement nul sont sautées) : pour surligner la bonne case
  // « Solde précédent » depuis le side panel.
  prevDisp?: { solde?: (string | undefined)[]; soldePrevu?: (string | undefined)[]; soldeDepass?: (string | undefined)[] };
  // Classe de revenu (pour les colonnes Budg./Revenus des rémunérations).
  incomeKind?: "principal" | "supplementary" | null;
  // Ce que la case « Budget dép. » de cette ligne laisse modifier, au mois donné, ou
  // null si rien (groupe récurrent, dont le budget est la somme de ses lignes). Calculé
  // par l'appelant, seul à savoir s'il rend une enveloppe, un récurrent ou une de ses
  // lignes — voir budgetEditOfGroup / budgetEditOfLine.
  budgetEditOf?: (month: string) => BudgetEditInfo | null;
  // Y a-t-il, ce mois-là, un dépassement CHEZ cette ligne de groupe ? Vrai pour un
  // récurrent dont une ligne déborde : sa propre Balance peut être positive, mais
  // l'étiquette doit tout de même apparaître — replié, rien d'autre ne le dirait.
  signaleDepassement?: (month: string) => boolean;
  // Bandeau de dépassement de CETTE ligne au mois donné, ou null. Fourni par
  // l'appelant, seul à savoir si la ligne est une enveloppe, un récurrent ou une de ses
  // lignes — et à disposer du montant dépassé.
  noticeOf?: (month: string) => OverspendNoticeInfo | null;
}) {
  // Mois où le budget de cette ligne change par rapport au mois précédent, pour
  // poser un repère discret sur la case correspondante (cf. budgetChangePoints).
  // aliveMonths est transmis pour ne jamais marquer un mois de naissance ou de
  // reprise (le budget y saute du 0 forcé des mois morts vers le vrai montant,
  // sans qu'il ait vraiment changé). Les lignes de groupe comme les sous-lignes en
  // reçoivent un, chacune avec SA vie propre ; sans detailRow (totaux de section),
  // budgetChangePoints retombe sur « toujours vivant » et le repère reste possible.
  const changes = budgetChangePoints(cells, detailRow?.aliveMonths);
  return (
    <>
      {cells.map((c, i) => {
        if (skipMonth(only, i)) return null;
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = subtitleOf?.(i);
        const r = detailRow;
        const ck = (col: Col) => cellKey(rowKey, col, i);
        // Mois où ce groupe n'a pas encore de durée de vie / n'existe plus (Task 4) :
        // les colonnes du groupe (budget, dépensé, reçu, reste) s'affichent vides —
        // rien, pas « 0,00 ». Les colonnes de solde ne sont pas concernées : elles
        // poursuivent leur propre chaîne cumulée indépendamment de ce groupe.
        const dead = r ? r.aliveMonths[i] === false : false;

        // Dép. affiche c.depense sauf pour une entrée (—) : cliquable même à 0,00,
        // avec les transactions du mois si présentes, sinon aucune décomposition.
        const depDetail: CellDetail | null =
          mode !== "in" && r
            ? makeDetail("Dépensé", txnChildren(r, month, 1, i) ?? [], { subtitle, result: c.depense })
            : null;

        // Reçu affiche c.recu sauf pour une dépense (—) : cliquable même à 0,00.
        const recuDetail: CellDetail | null =
          mode !== "out" && r
            ? makeDetail("Reçu", txnChildren(r, month, 1, i) ?? [], { subtitle, result: c.recu })
            : null;

        // Reste affiche c.balance sauf pour une entrée (case vide) : cliquable même à
        // 0,00. Décomposition Budget − Dépensé quand l'invariant tient, sinon aucune.
        const resteDetail: CellDetail | null =
          mode !== "in" && r
            ? makeDetail(
                "Reste",
                Math.abs(c.budgeted - c.depense - c.balance) < 0.005
                  ? [
                      { label: "Budget", amount: c.budgeted, ref: ck("budget") },
                      { label: "Dépensé", amount: -c.depense, children: txnChildren(r, month, -1, i), ref: ck("depense") },
                    ]
                  : [],
                { subtitle, result: c.balance },
              )
            : null;
        // Étiquette « dépassement » : une Balance négative d'un mois passé ou courant
        // (les mois à venir n'ont rien de réel). `signaleDepassement` la pose aussi sur
        // un groupe récurrent dont une ligne déborde : replié, rien d'autre ne le dirait.
        // L'étiquette et le bandeau lisent la LISTE des dépassements, pas le signe du
        // montant : c'est ce qui les fait disparaître ensemble quand on clique « Vu ».
        const enDepassement = mode === "out" && !!r && (signaleDepassement?.(month) ?? false);
        // Le bandeau suit la même liste que l'étiquette : acquitter en retire les deux.
        if (resteDetail && enDepassement) {
          resteDetail.overspendNotice = noticeOf?.(month) ?? undefined;
        }

        const s = solde?.[i];
        const net = c.recu - c.depense;
        // Solde précédent = solde de cette ligne − son propre mouvement.
        const soldeDetail: CellDetail | null =
          s != null && r
            ? makeDetail(
                "Solde",
                [
                  { label: "Solde précédent", amount: s - net, ref: prevDisp?.solde?.[i] ? cellKey(prevDisp.solde[i]!, "solde", i) : undefined },
                  // Le mouvement d'une entrée vit dans la colonne Reçu, celui d'une
                  // dépense dans Dép. — même quand le montant est encore à 0 (netCol
                  // retomberait alors sur Dép., faux pour une rémunération).
                  { label: "Mouvement du mois", amount: net, children: txnChildren(r, month, net < 0 ? -1 : 1, i), ref: ck(mode === "in" ? "recu" : mode === "out" ? "depense" : netCol(c)) },
                ],
                { subtitle, result: s },
              )
            : null;

        // --- Détails des colonnes de projection (mois courant / futurs) ---------
        const isCurrent = month === currentMonth;

        // Budget rémunération (ce qui rentre) : montant de la rémunération. Principale
        // sur tous les mois ; supplémentaire au mois courant seulement (— sinon, non
        // projetée) ; — pour une dépense. Clé de case « revenus ».
        const budgetRemVal: number | null =
          mode === "in" ? (incomeKind === "supplementary" ? (isCurrent ? c.budgeted : null) : c.budgeted) : null;
        const budgetRemDetail: CellDetail | null =
          budgetRemVal != null && r
            ? makeDetail("Budget rémunération", [{ label: r.name, amount: budgetRemVal, ref: ck("revenus") }], { subtitle, result: budgetRemVal })
            : null;
        // Une rémunération est une enveloppe comme une autre, en entrée : son montant
        // est daté et se modifie donc, lui aussi, dans SA case — celle-ci, puisqu'une
        // ligne d'entrée n'a pas de case « Budget dép. ». Sans ça, retirer le montant du
        // panneau du crayon aurait supprimé tout moyen de fixer un revenu.
        if (budgetRemDetail && !dead) {
          budgetRemDetail.budgetEdit = budgetEditOf?.(month) ?? undefined;
        }

        // Budget dépense (ce qui sort) : budget d'enveloppe / récurrent ; — pour une
        // entrée. Postes du récurrent si présents, sinon un nœud unique (enveloppe).
        const budgetDepVal: number | null = mode === "out" ? c.budgeted : null;
        const budgetDepDetail: CellDetail | null =
          budgetDepVal != null && r
            ? makeDetail("Budget dépense", budgetNodes(r, i) ?? [{ label: r.name, amount: c.budgeted, ref: ck("budget") }], { subtitle, result: c.budgeted })
            : null;
        // Bloc d'édition du montant sous la décomposition : c'est ici, au mois de la
        // colonne, que le budget se modifie. Sur un mois mort (la ligne n'existe pas
        // encore ou plus) il n'y a rien à fixer : la case est vide, pas à 0.
        if (budgetDepDetail && !dead) {
          budgetDepDetail.budgetEdit = budgetEditOf?.(month) ?? undefined;
        }

        // Mouvement prévu du mois de cette ligne = revenus projeté − budget (même
        // net que la chaîne « solde prévu »).
        const revenusProj = mode === "in" ? (incomeKind === "supplementary" ? (isCurrent ? c.budgeted : 0) : c.budgeted) : 0;
        const budgetProj = mode === "out" ? c.budgeted : 0;
        const mouvementPrevu = revenusProj - budgetProj;
        // Décomposition du mouvement prévu : pour une dépense, les postes du budget
        // (négatifs) ; pour une entrée, le revenu projeté. Chaque enfant pointe vers
        // sa case, pour tracer d'où vient le montant.
        const mouvementChildren: DetailNode[] =
          mode === "out" && r
            ? (budgetNodes(r, i)?.map(negateNode) ?? [{ label: r.name, amount: -c.budgeted, ref: ck("budget") }])
            : mode === "in" && r
              ? [{ label: r.name, amount: revenusProj, ref: ck("revenus") }]
              : [];
        const sp = soldePrevu?.[i];
        const soldePrevuDetail: CellDetail | null =
          sp != null && r
            ? makeDetail(
                "Solde prévu",
                [
                  { label: "Solde précédent", amount: sp - mouvementPrevu, ref: prevDisp?.soldePrevu?.[i] ? cellKey(prevDisp.soldePrevu[i]!, "soldePrevu", i) : undefined },
                  { label: "Mouvement prévu du mois", amount: mouvementPrevu, ref: mode === "out" ? ck("budget") : mode === "in" ? ck("revenus") : undefined, children: mouvementChildren.length ? mouvementChildren : undefined },
                ],
                { subtitle, result: sp },
              )
            : null;
        const sd = soldeDepass?.[i];
        // Solde si dépassement : même décomposition en chaîne que « Solde prévu »
        // (valeur de la ligne du dessus + mouvement prévu du mois), puis on retire le
        // seul dépassement de CETTE ligne. La chaîne « si dépassement » repart de zéro
        // à chaque section (cf. computePlannedSoldes) : le « précédent » d'une ligne
        // est donc bien le « Solde si dépassement » de la ligne juste au-dessus dans sa
        // section, sans traîner les dépassements des sections du dessus.
        // Mois source du dépassement : sur un mois de projection, il vient du dépassement
        // retenu (marqué permanent) du mois courant, pas du mois affiché (dont la Balance
        // est à 0). Le montant ET le renvoi se lisent au même mois source : le chiffre
        // affiché est bien celui de la case qu'on surligne.
        const ciIdx = months.indexOf(currentMonth);
        const osSrcI = month > currentMonth && ciIdx !== -1 ? ciIdx : i;
        const ownOs = r ? rowOverspend(r, osSrcI) : 0;
        const soldeDepassDetail: CellDetail | null =
          sd != null && sp != null && r
            ? makeDetail(
                "Solde si dépassement",
                [
                  { label: "Solde précédent", amount: sd - mouvementPrevu + ownOs, ref: prevDisp?.soldeDepass?.[i] ? cellKey(prevDisp.soldeDepass[i]!, "soldeDepass", i) : undefined },
                  { label: "Mouvement prévu du mois", amount: mouvementPrevu, ref: mode === "out" ? ck("budget") : mode === "in" ? ck("revenus") : undefined, children: mouvementChildren.length ? mouvementChildren : undefined },
                  // Le dépassement propre à la ligne (sa Balance rouge), renvoi vers sa case
                  // du mois source.
                  ...(ownOs > 0.005
                    ? [{ label: "Dépassement", amount: -ownOs, ref: cellKey(rowKey, "reste", osSrcI) }]
                    : []),
                ],
                { subtitle, result: sd },
              )
            : null;

        // Repère de changement de budget : seulement sur la case qui affiche
        // vraiment un budget ce mois-ci (pas sur une case laissée vide, ni sur un
        // mois mort). Discret — bordure, pas de couleur d'alerte — et doublé d'un
        // texte pour lecteur d'écran (la bordure seule ne dit rien sans la vue).
        const budgetRemChanged = !dead && changes[i] && budgetRemVal != null;
        const budgetDepChanged = !dead && changes[i] && budgetDepVal != null;

        // Colonnes réelles : cliquables (détail + surbrillance) comme avant.
        // Colonnes de projection : désormais cliquables aussi (détail + clé de case).
        const slots: ColSlots = {
          budgetRem: (b) =>
            dead ? blankCol("budgetRem", b) : (
              <CellAmount key="budgetRem" className={cn(b && MONTH_GAP, "text-right tabular-nums", budgetRemChanged && "border-l-muted-foreground/40 border-l-2")} detail={budgetRemDetail} onSelect={onSelect} cellKey={ck("revenus")} selCellKey={selCellKey}>
                {budgetRemVal != null ? fmt(budgetRemVal) : ""}
                {budgetRemChanged && <span className="sr-only"> (budget modifié ce mois-ci)</span>}
              </CellAmount>
            ),
          budgetDep: (b) =>
            dead ? blankCol("budgetDep", b) : (
              <CellAmount key="budgetDep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground", budgetDepChanged && "border-l-muted-foreground/40 border-l-2")} detail={budgetDepDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
                {budgetDepVal != null ? fmt(budgetDepVal) : ""}
                {budgetDepChanged && <span className="sr-only"> (budget modifié ce mois-ci)</span>}
              </CellAmount>
            ),
          dep: (b) =>
            dead ? blankCol("dep", b) : (
              <CellAmount key="dep" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={depDetail} onSelect={onSelect} cellKey={ck("depense")} selCellKey={selCellKey}>
                {mode === "in" ? "" : fmt(c.depense)}
              </CellAmount>
            ),
          recu: (b) =>
            dead ? blankCol("recu", b) : (
              <CellAmount key="recu" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={ck("recu")} selCellKey={selCellKey}>
                {mode === "out" ? "" : fmt(c.recu)}
              </CellAmount>
            ),
          reste: (b) =>
            dead ? blankCol("reste", b) : (
              <CellAmount key="reste" className={cn(b && MONTH_GAP, "text-right tabular-nums", mode !== "in" && resteColor(c.balance))} detail={resteDetail} onSelect={onSelect} cellKey={ck("reste")} selCellKey={selCellKey}>
                {mode === "in" ? "" : (
                  <>
                    {fmt(c.balance)}
                    {/* Conteneur flex : il force le retour à la ligne sous le montant et,
                        parce qu'il ouvre un contexte de formatage indépendant, il empêche
                        le soulignement de survol de la case de déborder sur l'étiquette. */}
                    {enDepassement && (
                      <span className="mt-0.5 flex justify-end">
                        <OverspendTag />
                      </span>
                    )}
                  </>
                )}
              </CellAmount>
            ),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && MONTH_GAP, "text-right tabular-nums", soldeColor(s, net))} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {s != null ? soldeWithSign(s, net) : ""}
            </CellAmount>
          ),
          soldePrevu: (b) => plannedSoldeCell("soldePrevu", soldePrevu?.[i] ?? null, b, soldePrevuDetail, onSelect, ck("soldePrevu"), selCellKey, mouvementPrevu),
          soldeDepass: (b) => plannedSoldeCell("soldeDepass", soldeDepass?.[i] ?? null, b, soldeDepassDetail, onSelect, ck("soldeDepass"), selCellKey, mouvementPrevu - ownOs),
        };

        return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
      })}
    </>
  );
}

// Sous-total d'une section (Récurrents / Enveloppes / Non catégorisés) : rendu
// dédié, pas via AmountCells, car aucun HistoryRow unique n'y est associé. Chaque
// cellule se déplie sur la liste des groupes de la section (ou, pour les non
// catégorisés qui n'ont pas de groupes, directement leurs transactions).
// Reste : pour Récurrents/Enveloppes (sections « out » uniquement), budget − dépensé
// == balance exactement par construction (chaque ligne vérifie déjà cette égalité,
// donc leur somme aussi) : toujours cliquable. Pour les non catégorisés, budget et
// balance sont toujours à 0 : l'invariant ne tient que si dépensé == 0, donc en
// pratique non cliquable (comme documenté au Task 3 pour ce cas).
function SectionTotalsCells({ sec, months, currentMonth, onSelect, solde, planPrevu, planDepass, uncatInSec, selCellKey, prevDisp, noticeOf, only }: OnlyMonth & {
  sec: HistorySection;
  months: string[];
  currentMonth: string;
  onSelect?: (d: CellDetail) => void;
  solde?: (number | null)[];
  // Soldes du plan (prévu / si dépassement) au niveau de cette ligne, pour les non
  // catégorisés : ils ne sont pas planifiés, donc le solde du plan les traverse
  // (les reçus reprennent la valeur après les rémunérations, les dépenses la
  // clôture du plan).
  planPrevu?: (number | null)[];
  planDepass?: (number | null)[];
  // Section « non catégorisés » côté reçus : fournie à la section côté dépenses
  // pour calculer sa Balance (Reçu de la ligne du haut − Dépensé de celle-ci).
  uncatInSec?: HistorySection;
  selCellKey?: ReadonlySet<string>;
  // Clé de la dernière ligne AFFICHÉE au-dessus, par colonne de solde et par mois
  // (cases vides sautées) : pour surligner la bonne case « Solde précédent ».
  prevDisp?: { solde?: (string | undefined)[]; soldePrevu?: (string | undefined)[]; soldeDepass?: (string | undefined)[] };
  // Bandeau de dépassement de la section (non catégorisés) au mois donné, ou null.
  noticeOf?: (month: string) => OverspendNoticeInfo | null;
}) {
  const isUncat = sec.kind === "uncategorized";
  // Section « non catégorisés » côté reçus (affichée sous les rémunérations).
  const uncatIn = isUncat && sec.uncatDirection === "in";
  const rowKey = sectionRowKey(sec);
  return (
    <>
      {sec.totals.map((c, i) => {
        if (skipMonth(only, i)) return null;
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = `${labelOfSection(sec.kind)} · ${monthLabel(month)}`;
        const ck = (col: Col) => cellKey(rowKey, col, i);

        // Budg. affiche toujours un nombre → toujours cliquable (décomposition par
        // groupe, éventuellement vide pour les non catégorisés qui n'ont pas de budget).
        const budgetDetail: CellDetail =
          makeDetail("Budget", sec.rows.map((r) => groupNode(r, i, month, "budget")), { subtitle, result: c.budgeted });

        // Provision des non catégorisés (côté dépenses uniquement) : la case Budget
        // dép. porte le montant daté du groupe 0 en vigueur ce mois-là, éditable
        // comme le montant d'une enveloppe (voir UncatProvisionBlock).
        const provisionDetail: CellDetail = {
          title: "Non catégorisés",
          nodes: [],
          result: 0,
          uncatProvision: { month, currentAmount: c.budgeted },
        };

        const depNodes = isUncat
          ? sectionTxnChildren(sec.txns, month, true, i)
          : sec.rows.map((r) => groupNode(r, i, month, "depense")).filter((n) => n.amount !== 0);
        const depDetail: CellDetail = makeDetail("Dépensé", depNodes ?? [], { subtitle, result: c.depense });

        const recuNodes = isUncat
          ? sectionTxnChildren(sec.txns, month, false, i)
          : sec.rows.map((r) => groupNode(r, i, month, "recu")).filter((n) => n.amount !== 0);
        const recuDetail: CellDetail = makeDetail("Reçu", recuNodes ?? [], { subtitle, result: c.recu });

        // Balance des non catégorisés (côté dépenses) : le mouvement net = Reçu de
        // la ligne « Non catégorisés » du haut (reçus) − Dépensé de celle-ci.
        const inRecu = uncatInSec?.totals[i]?.recu ?? 0;
        const inRecuNodes = uncatInSec ? sectionTxnChildren(uncatInSec.txns, month, false, i) : undefined;
        // La Balance est celle que computeHistory a posée, y compris pour les non
        // catégorisés (provision + reçus sans groupe − dépensé) : la grille ne la
        // recalcule pas de son côté.
        const resteVal = c.balance;
        // Balance toujours affichée → toujours cliquable. Décomposition : Reçu (ligne
        // des reçus non catégorisés) − Dépensé pour les non catégorisés, Budget −
        // Dépensé pour les autres sections (quand l'invariant tient).
        const resteDetail: CellDetail = makeDetail(
          "Balance",
          isUncat
            ? [
                {
                  label: "Reçu",
                  amount: inRecu,
                  ref: uncatInSec ? cellKey(sectionRowKey(uncatInSec), "recu", i) : undefined,
                  children: inRecuNodes ?? undefined,
                },
                {
                  label: "Dépensé",
                  amount: -c.depense,
                  ref: ck("depense"),
                  children: (depNodes ?? []).map(negateNode),
                },
              ]
            : Math.abs(c.budgeted - c.depense - c.balance) < 0.005
              ? [
                  { label: "Budget", amount: c.budgeted, ref: ck("budget") },
                  {
                    label: "Dépensé",
                    amount: -c.depense,
                    ref: ck("depense"),
                    children: (depNodes ?? []).map(negateNode),
                  },
                ]
              : [],
          { subtitle, result: resteVal },
        );
        // Étiquette et bandeau des non catégorisés côté dépenses : même lecture de la
        // liste que partout ailleurs, pour qu'un « Vu » les retire tous les deux.
        const notice = noticeOf?.(month) ?? null;
        const enDepassement = isUncat && !uncatIn && !!notice;
        if (enDepassement) resteDetail.overspendNotice = notice;

        const s = solde?.[i];
        const net = c.recu - c.depense;
        const soldeDetail: CellDetail | null =
          s != null
            ? makeDetail(
                "Solde",
                [
                  { label: "Solde précédent", amount: s - net, ref: prevDisp?.solde?.[i] ? cellKey(prevDisp.solde[i]!, "solde", i) : undefined },
                  { label: "Mouvement du mois", amount: net, children: uncatTxnNodes(sec, month, i), ref: ck(netCol(c)) },
                ],
                { subtitle, result: s },
              )
            : null;

        // Dépassement des non catégorisés = la part rouge de leur Balance (dépensé
        // au-delà des reçus et de la provision non catégorisés). Sert au calcul du
        // solde si dépassement. Mois futur : repli sur celui du mois courant (plus de
        // report retenu — cf. computePlannedSoldes).
        const ciIdx = months.indexOf(currentMonth);
        const isFuture = month > currentMonth;
        const srcI = isFuture && ciIdx !== -1 ? ciIdx : i;
        const depassVal =
          isUncat && !uncatIn ? uncatOverspendOf(sec.totals[srcI], uncatInSec?.totals[srcI]) : 0;

        // Non catégorisés comme étape du plan : planPrevu/planDepass fournissent les
        // valeurs courues à cette ligne (le débordement net est déjà retiré de la
        // chaîne « si dépassement » — cf. computePlannedSoldes). Le détail repose le
        // calcul : valeur précédente (au-dessus) − dépassement de la ligne.
        const soldePrevuVal = planPrevu?.[i] ?? null;
        const soldeDepassVal = planDepass?.[i] ?? null;
        const soldePrevuDetail: CellDetail | null =
          isUncat && soldePrevuVal != null
            ? makeDetail(
                "Solde prévu",
                [
                  { label: "Solde précédent", amount: soldePrevuVal + c.budgeted, ref: prevDisp?.soldePrevu?.[i] ? cellKey(prevDisp.soldePrevu[i]!, "soldePrevu", i) : undefined },
                  { label: "Budget dépense", amount: -c.budgeted, ref: ck("budget") },
                ],
                { subtitle, result: soldePrevuVal },
              )
            : null;
        const soldeDepassDetail: CellDetail | null =
          isUncat && soldeDepassVal != null
            ? makeDetail(
                "Solde si dépassement",
                [
                  // Les non catégorisés récapitulent tout : ils affichent le cumul
                  // global (runD). Le détail chaîne donc sur la valeur du dessus
                  // (soldeDepassVal + depassVal = le cumul avant leur propre débordement).
                  { label: "Solde précédent", amount: soldeDepassVal + depassVal, ref: prevDisp?.soldeDepass?.[i] ? cellKey(prevDisp.soldeDepass[i]!, "soldeDepass", i) : undefined },
                  // Débordement retenu (marqué permanent) sur les mois futurs, sinon celui du
                  // mois courant. Renvoi vers la Balance du mois SOURCE (srcI) : sur un
                  // mois de projection, le débordement vient du mois courant, pas du mois
                  // affiché (dont la Balance est à 0).
                  ...(depassVal > 0.005
                    ? [{ label: "Dépassement", amount: -depassVal, ref: cellKey(rowKey, "reste", srcI) }]
                    : []),
                ],
                { subtitle, result: soldeDepassVal },
              )
            : null;

        const slots: ColSlots = {
          budgetRem: (b) => (
            <TableCell key="budgetRem" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")}></TableCell>
          ),
          // Les non catégorisés côté reçus n'ont pas de budget : « — ». Côté dépenses,
          // la case porte la provision (montant daté du groupe 0), éditable comme le
          // budget d'une enveloppe.
          budgetDep: (b) =>
            uncatIn ? (
              <TableCell key="budgetDep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")}></TableCell>
            ) : (
              <CellAmount key="budgetDep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")} detail={isUncat ? provisionDetail : budgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
                {fmt(c.budgeted)}
              </CellAmount>
            ),
          dep: (b) =>
            uncatIn ? (
              <TableCell key="dep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")}></TableCell>
            ) : (
              <CellAmount key="dep" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={depDetail} onSelect={onSelect} cellKey={ck("depense")} selCellKey={selCellKey}>
                {fmt(c.depense)}
              </CellAmount>
            ),
          // Seuls les non catégorisés côté reçus encaissent : les sections de dépense
          // (Récurrents / Enveloppes / non catégorisés côté dépenses) affichent « — ».
          recu: (b) =>
            uncatIn ? (
              <CellAmount key="recu" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={ck("recu")} selCellKey={selCellKey}>
                {fmt(c.recu)}
              </CellAmount>
            ) : (
              <TableCell key="recu" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")}></TableCell>
            ),
          // Balance : affichée seulement pour les non catégorisés côté dépenses (les
          // reçus n'ont pas de budget à confronter ; Récurrents / Enveloppes ont leurs
          // lignes « Balance ... » dédiées).
          reste: (b) =>
            isUncat && !uncatIn ? (
              <CellAmount key="reste" className={cn(b && MONTH_GAP, "text-right tabular-nums", resteColor(resteVal))} detail={resteDetail} onSelect={onSelect} cellKey={ck("reste")} selCellKey={selCellKey}>
                {fmt(resteVal)}
                {enDepassement && (
                  <span className="mt-0.5 flex justify-end">
                    <OverspendTag />
                  </span>
                )}
              </CellAmount>
            ) : (
              blankCol("reste", b)
            ),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && MONTH_GAP, "text-right tabular-nums", soldeColor(s, net))} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {s != null ? soldeWithSign(s, net) : ""}
            </CellAmount>
          ),
          // Non catégorisés : on affiche le solde du plan (identique aux clôtures
          // prévues du mois) ; les autres sections de dépense restent vides. Mouvement
          // de la ligne : −budget (provision) pour le prévu, −débordement pour le si
          // dépassement (cf. les nœuds « précédent » des détails ci-dessus).
          soldePrevu: (b) =>
            isUncat
              ? plannedSoldeCell("soldePrevu", soldePrevuVal, b, soldePrevuDetail, onSelect, ck("soldePrevu"), selCellKey, -c.budgeted)
              : plannedSoldeCol("soldePrevu", null, b),
          soldeDepass: (b) =>
            isUncat
              ? plannedSoldeCell("soldeDepass", soldeDepassVal, b, soldeDepassDetail, onSelect, ck("soldeDepass"), selCellKey, -depassVal)
              : plannedSoldeCol("soldeDepass", null, b),
        };

        return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
      })}
    </>
  );
}

// Ligne « Total rémunérations » : somme des rémunérations principale et
// supplémentaire. Seule la colonne Reçu est renseignée (les rémunérations n'ont ni
// budget ni dépense) ; cliquable → détail dépliable jusqu'aux transactions.
function IncomeTotalCells({ sec, months, currentMonth, onSelect, selCellKey, only }: OnlyMonth & {
  sec: HistorySection;
  months: string[];
  currentMonth: string;
  onSelect?: (d: CellDetail) => void;
  selCellKey?: ReadonlySet<string>;
}) {
  return (
    <>
      {sec.totals.map((c, i) => {
        if (skipMonth(only, i)) return null;
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = `Rémunérations · ${monthLabel(month)}`;
        // Reçu toujours affiché → toujours cliquable (décomposition par rémunération).
        const recuDetail: CellDetail = makeDetail(
          "Rémunérations",
          sec.rows.map((r) => groupNode(r, i, month, "recu")).filter((n) => n.amount !== 0),
          { subtitle, result: c.recu },
        );
        // Budget rémunération total = somme des rémunérations affichées (principale
        // tous mois, supplémentaire au mois courant seulement), décomposé par ligne.
        const isCur = month === currentMonth;
        const budgetRemTotal = sec.rows.reduce((s, r) => s + rowRevenus(r, i, isCur), 0);
        const budgetRemNodes = sec.rows
          .map((r): DetailNode => ({ label: r.name, amount: rowRevenus(r, i, isCur), ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const budgetRemDetail: CellDetail = makeDetail("Budget rémunération", budgetRemNodes, { subtitle, result: budgetRemTotal });

        const slots: ColSlots = {
          budgetRem: (b) => (
            <CellAmount key="budgetRem" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={budgetRemDetail} onSelect={onSelect} cellKey={cellKey(sectionRow("income"), "revenus", i)} selCellKey={selCellKey}>
              {fmt(budgetRemTotal)}
            </CellAmount>
          ),
          budgetDep: (b) => (
            <TableCell key="budgetDep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")}></TableCell>
          ),
          dep: (b) => (
            <TableCell key="dep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")}></TableCell>
          ),
          recu: (b) => (
            <CellAmount key="recu" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={cellKey(sectionRow("income"), "recu", i)} selCellKey={selCellKey}>
              {fmt(c.recu)}
            </CellAmount>
          ),
          reste: (b) => blankCol("reste", b),
          soldeReel: (b) => blankCol("soldeReel", b),
          soldePrevu: (b) => blankCol("soldePrevu", b),
          soldeDepass: (b) => blankCol("soldeDepass", b),
        };

        return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
      })}
    </>
  );
}

// Ligne « Solde actuel » (grand total) : rendu dédié, pas via AmountCells. Budg./
// Dép./Reçu se déplient sur la liste des sections (elles-mêmes dépliables sur leurs
// groupes, puis leurs transactions) ; Solde = Argent de départ + chaque section.
// Reste : cliquable seulement si l'invariant budget − dépensé == balance tient
// (souvent faux au global : la section Rémunérations a un budget mais pas de
// dépense, donc généralement non cliquable — ce qui est acceptable, cf. brief).
function GrandTotalsCells({ sections, grand, solde, planned, months, currentMonth, currentEstimate, onSelect, selCellKey, only }: OnlyMonth & {
  sections: HistorySection[];
  grand: MonthCell[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  months: string[];
  currentMonth: string;
  // Estimé de fin du mois courant : point de départ des chaînes de plan du premier
  // mois futur (cf. computePlannedSoldes).
  currentEstimate?: number;
  onSelect?: (d: CellDetail) => void;
  selCellKey?: ReadonlySet<string>;
}) {
  return (
    <>
      {grand.map((c, i) => {
        if (skipMonth(only, i)) return null;
        const type = monthType(months[i], currentMonth);
        const cols = monthColumns(type);
        const month = months[i];
        const subtitle = monthLabel(month);
        const ck = (col: Col) => cellKey("grand", col, i);
        // Budget rémunération total = somme des rémunérations affichées (principale
        // tous mois, supplémentaire au mois courant seulement).
        const isCur = month === currentMonth;
        const allRows = sections.flatMap((s) => s.rows);
        const budgetRemTotal = allRows.reduce((a, r) => a + rowRevenus(r, i, isCur), 0);

        // Budget des dépenses seulement (enveloppes + récurrents, hors rémunérations).
        const expenseBudget = sections.reduce((s, sec) => s + (sec.kind === "income" ? 0 : sec.totals[i].budgeted), 0);

        // Dép./Reçu/Reste du grand total : toujours un nombre affiché → toujours
        // cliquables (décomposition par section, éventuellement vide).
        const depDetail: CellDetail = makeDetail(
          "Dépensé",
          sections.map((sec) => sectionNode(sec, i, month, "depense")).filter((n) => n.amount !== 0),
          { subtitle, result: c.depense },
        );
        const recuDetail: CellDetail = makeDetail(
          "Reçu",
          sections.map((sec) => sectionNode(sec, i, month, "recu")).filter((n) => n.amount !== 0),
          { subtitle, result: c.recu },
        );
        // Reste : non affiché sur la ligne « Solde actuel » (grand total) — un reste
        // agrégé toutes catégories confondues n'est pas parlant.
        const soldeDetail: CellDetail = soldeActuelDetail(sections, solde, i, month, { title: "Solde actuel", result: solde.closings[i] });

        // --- Détails des colonnes de projection du grand total ------------------
        // Budget de projection : seules les sections de dépense (cohérent avec la
        // valeur affichée expenseBudget, qui exclut les rémunérations). On écarte les
        // nœuds à zéro comme pour « Dépensé » / « Reçu » : sinon les deux sections
        // « Non catégorisés » (reçus, sans budget, et dépenses sans provision)
        // apparaissent en double à 0,00.
        const expenseBudgetDetail: CellDetail =
          makeDetail("Budget", sections.filter((sec) => sec.kind !== "income").map((sec) => sectionNode(sec, i, month, "budget")).filter((n) => n.amount !== 0), { subtitle, result: expenseBudget });
        // Détail du budget rémunération : un nœud par rémunération affichée.
        const budgetRemNodes = allRows
          .filter((r) => r.direction === "in")
          .map((r): DetailNode => ({ label: r.name, amount: rowRevenus(r, i, isCur), ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const budgetRemDetail: CellDetail = makeDetail("Budget rémunération", budgetRemNodes, { subtitle, result: budgetRemTotal });
        // Mois de référence des dépassements maintenus (mois courant en projection).
        const ciIdx = months.indexOf(currentMonth);
        const cs = month <= currentMonth || ciIdx === -1 ? i : ciIdx;
        // Soldes de plan (prévu / si dépassement) : structure « précédent + mouvement ».
        // Le « précédent » = l'ouverture réelle du mois (passé / courant, où le plan
        // s'ancre), ou la clôture prévue du mois passé (futur). Le mouvement =
        // clôture − précédent (exact par défaut).
        const prevuClose = planned.prevuClosings[i];
        const depassClose = planned.depassClosings[i];
        // Premier mois futur : la chaîne du plan repart de l'estimé de fin du mois courant.
        const firstFuture = month > currentMonth && i > 0 && months[i - 1] === currentMonth;
        const prevuPrev =
          month <= currentMonth ? solde.openings[i]
          : firstFuture && currentEstimate != null ? currentEstimate
          : i > 0 && planned.prevuClosings[i - 1] != null ? planned.prevuClosings[i - 1]! : solde.openings[i];
        // Décomposition du mouvement prévu du mois = revenus prévus − budget de dépenses.
        const revenusChildren = allRows
          .filter((r) => r.direction === "in")
          .map((r): DetailNode => ({ label: r.name, amount: rowRevenus(r, i, isCur), ref: cellKey(groupRow(r.id), "revenus", i) }))
          .filter((n) => n.amount !== 0);
        const budgetChildren = sections
          .filter((sec) => sec.kind !== "income")
          .map((sec) => negateNode(sectionNode(sec, i, month, "budget")))
          .filter((n) => n.amount !== 0);
        const mouvementPrevuNode: DetailNode = {
          label: "Mouvement prévu du mois",
          amount: prevuClose != null ? prevuClose - prevuPrev : 0,
          children: [
            { label: "Revenus prévus", amount: budgetRemTotal, ref: ck("revenus"), children: revenusChildren },
            { label: "Budget", amount: -expenseBudget, ref: ck("budget"), children: budgetChildren },
          ],
        };
        const soldePrevuDetail: CellDetail | null =
          prevuClose != null
            ? makeDetail(
                "Solde prévu",
                [
                  {
                    label: firstFuture ? "Estimé fin du mois précédent" : "Solde précédent",
                    amount: prevuPrev,
                    ref:
                      month <= currentMonth ? cellKey(openingRow, "soldePrevu", i)
                      : firstFuture ? cellKey("estime", "solde", i - 1)
                      : cellKey("grand", "soldePrevu", i - 1),
                  },
                  mouvementPrevuNode,
                ],
                { subtitle, result: prevuClose },
              )
            : null;
        // Dépassement cumulé du grand total = dépassement total maintenu, décomposé
        // par groupe. Mois passés/courant : montants réels du mois affiché. Mois
        // futurs : repli sur ceux du mois courant (cf. cs ; plus de report retenu —
        // cf. computePlannedSoldes). Les renvois pointent toujours vers les cases
        // Balance du mois affiché : la surbrillance reste dans la colonne du mois cliqué.
        const uncatOs = uncatOverspend(sections, cs);
        const overspendRows: { id: number; name: string; amount: number }[] = allRows
          .filter((r) => r.direction === "out" && r.cells[cs].balance < 0)
          .map((r) => ({ id: r.id, name: r.name, amount: r.cells[cs].balance }));
        const grandOverspendChildren: DetailNode[] = [
          ...overspendRows.map((r): DetailNode => ({ label: r.name, amount: r.amount, ref: cellKey(groupRow(r.id), "reste", i) })),
          // Débordement net des non catégorisés (dépensé au-delà des reçus), inclus
          // dans la chaîne « si dépassement » comme les dépassements de budget.
          ...(uncatOs > 0.005
            ? [{ label: "Non catégorisés", amount: -uncatOs, ref: cellKey(sectionRow("uncategorized"), "reste", i) }]
            : []),
        ];
        const soldeDepassDetail: CellDetail | null =
          depassClose != null && prevuClose != null
            ? makeDetail(
                "Solde si dépassement",
                [
                  { label: "Solde prévu", amount: prevuClose, ref: ck("soldePrevu") },
                  // La somme n'existe pas telle quelle : surligner ensemble les cases
                  // Balance rouges qui la composent.
                  {
                    label: "Dépassement cumulé",
                    amount: -(prevuClose - depassClose),
                    refs: grandOverspendChildren.map((n) => n.ref!).filter(Boolean),
                    children: grandOverspendChildren,
                  },
                ],
                { subtitle, result: depassClose },
              )
            : null;

        const slots: ColSlots = {
          budgetRem: (b) => (
            <CellAmount key="budgetRem" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={budgetRemDetail} onSelect={onSelect} cellKey={ck("revenus")} selCellKey={selCellKey}>
              {fmt(budgetRemTotal)}
            </CellAmount>
          ),
          budgetDep: (b) => (
            <CellAmount key="budgetDep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")} detail={expenseBudgetDetail} onSelect={onSelect} cellKey={ck("budget")} selCellKey={selCellKey}>
              {fmt(expenseBudget)}
            </CellAmount>
          ),
          dep: (b) => (
            <CellAmount key="dep" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={depDetail} onSelect={onSelect} cellKey={ck("depense")} selCellKey={selCellKey}>
              {fmt(c.depense)}
            </CellAmount>
          ),
          recu: (b) => (
            <CellAmount key="recu" className={cn(b && MONTH_GAP, "text-right tabular-nums")} detail={recuDetail} onSelect={onSelect} cellKey={ck("recu")} selCellKey={selCellKey}>
              {fmt(c.recu)}
            </CellAmount>
          ),
          reste: (b) => blankCol("reste", b),
          soldeReel: (b) => (
            <CellAmount key="soldeReel" className={cn(b && MONTH_GAP, "text-right tabular-nums", soldeColor(solde.closings[i]))} detail={soldeDetail} onSelect={onSelect} cellKey={ck("solde")} selCellKey={selCellKey}>
              {fmt(solde.closings[i])}
            </CellAmount>
          ),
          soldePrevu: (b) => plannedSoldeCell("soldePrevu", planned.prevuClosings[i], b, soldePrevuDetail, onSelect, ck("soldePrevu"), selCellKey),
          soldeDepass: (b) => plannedSoldeCell("soldeDepass", planned.depassClosings[i], b, soldeDepassDetail, onSelect, ck("soldeDepass"), selCellKey),
        };

        return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
      })}
    </>
  );
}

// Cellules d'une transaction : son montant tombe dans la colonne Dép. (sortie)
// ou Reçu (entrée), selon son signe, du mois où elle a lieu ; le reste est vide.
function TxnCells({ txn, months, currentMonth, onSelect, selCellKey, only }: OnlyMonth & { txn: HistoryTxn; months: string[]; currentMonth: string; onSelect?: (d: CellDetail) => void; selCellKey?: ReadonlySet<string> }) {
  const isOut = txn.amount < 0;
  return (
    <>
      {months.map((m, i) => {
        if (skipMonth(only, i)) return null;
        const cols = monthColumns(monthType(m, currentMonth));
        const here = txn.month === m;
        const val = here ? fmt(Math.abs(txn.amount)) : "";
        // La transaction n'occupe qu'une case : Dép. si sortie, Reçu si entrée. En
        // mois de projection, ni Dép. ni Reçu n'existent : la ligne reste vide.
        const ck = here ? cellKey(txnRow(txn.id), isOut ? "depense" : "recu", i) : undefined;
        // Détail minimal d'une transaction : une seule feuille (elle-même), pour que
        // sa case chiffrée soit cliquable comme les montants agrégés.
        const detail: CellDetail | null = here
          ? makeDetail(
              "Transaction",
              [{ label: `${txn.date} · ${txn.label}`, amount: Math.abs(txn.amount) }],
              { subtitle: monthLabel(m), result: Math.abs(txn.amount) },
            )
          : null;
        const slots: ColSlots = {
          budgetRem: (b) => blankCol("budgetRem", b),
          budgetDep: (b) => blankCol("budgetDep", b),
          dep: (b) =>
            here && isOut ? (
              <CellAmount key="dep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")} detail={detail} onSelect={onSelect} cellKey={ck} selCellKey={selCellKey}>
                {val}
              </CellAmount>
            ) : (
              <TableCell key="dep" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")} />
            ),
          recu: (b) =>
            here && !isOut ? (
              <CellAmount key="recu" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")} detail={detail} onSelect={onSelect} cellKey={ck} selCellKey={selCellKey}>
                {val}
              </CellAmount>
            ) : (
              <TableCell key="recu" className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")} />
            ),
          reste: (b) => blankCol("reste", b),
          soldeReel: (b) => blankCol("soldeReel", b),
          soldePrevu: (b) => blankCol("soldePrevu", b),
          soldeDepass: (b) => blankCol("soldeDepass", b),
        };
        return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
      })}
    </>
  );
}

// Cellule gauche (sticky) d'une ligne, avec retrait et chevron optionnel.
function NameCell({ children, indent, expandable, expanded, onToggle, bg = "bg-background" }: {
  children: React.ReactNode;
  indent: number;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  bg?: string;
}) {
  return (
    <TableCell
      className={cn(bg, "h-px p-0", expandable && "cursor-pointer")}
      onClick={onToggle}
    >
      <FirstColBox indent={indent}>
        {expandable ? (
          expanded ? <ChevronDown className="size-4 shrink-0" /> : <ChevronRight className="size-4 shrink-0" />
        ) : (
          <span className="inline-block size-4 shrink-0" />
        )}
        {children}
      </FirstColBox>
    </TableCell>
  );
}

// Ligne de transaction : « date · libellé » puis, en dessous, le menu de
// (ré)assignation de groupe. Le montant tombe dans la colonne de son mois.
function TxnRow({ txn, months, currentMonth, groups, indent, onSelect, selCellKey, ignored = false, only }: OnlyMonth & {
  txn: HistoryTxn;
  months: string[];
  currentMonth: string;
  groups: SelectGroup[];
  indent: number;
  onSelect?: (d: CellDetail) => void;
  selCellKey?: ReadonlySet<string>;
  // Vrai dans la section « Non comptabilisées ». On y remplace le menu de
  // rattachement — sans effet tant que la transaction est hors calcul — par le
  // bouton de retour dans les calculs, avec son libellé puisque la place est libre.
  ignored?: boolean;
}) {
  return (
    <TableRow className="align-top text-sm text-muted-foreground">
      <TableCell className="bg-background h-px p-0">
        <div
          className="border-border/60 flex h-full flex-col gap-1 border-r py-2 pr-2 font-sans"
          style={{ width: COL1_W, paddingLeft: `${0.5 + indent * 1.25}rem` }}
        >
          {/* La date au-dessus, le libellé en dessous : côte à côte, la date mangeait
              un tiers de la colonne et coupait presque tous les libellés. Empilés, le
              libellé dispose de toute la largeur et déborde bien plus rarement. */}
          <div className="group/txn flex flex-col gap-0.5 overflow-hidden">
            {/* La date reste en chasse fixe : c'est une donnée, elle s'aligne
                d'une ligne à l'autre comme les montants. */}
            <span className="text-muted-foreground/80 font-mono text-xs">{txn.date}</span>
            <TruncatedText text={txn.label} className="leading-5" lines={2} />
            {/* Le commentaire vient juste sous le libellé, dans la même colonne. */}
            <TxnCommentField txnId={txn.id} comment={txn.comment} />
          </div>
          {ignored ? (
            <IgnoreTxnToggle txnId={txn.id} ignored withLabel />
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <GroupSelectField
                txnId={txn.id}
                groups={groups}
                defaultGroupId={txn.groupId}
                defaultLineId={txn.lineId}
                className="min-w-0 flex-1"
              />
              <IgnoreTxnToggle txnId={txn.id} ignored={false} size="icon-sm" />
            </div>
          )}
        </div>
      </TableCell>
      <TxnCells txn={txn} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} only={only} />
    </TableRow>
  );
}

// Ligne d'espacement entre deux sections : une bande vide de faible hauteur qui
// couvre toutes les colonnes, pour aérer visuellement sans ajouter de contenu.
function SpacerRow({ cols }: { cols: number }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={cols} className="h-8 border-0 p-0" />
    </TableRow>
  );
}

// Premier ancêtre réellement défilant sur un axe (x = horizontal, y = vertical).
// Sert à amener une case dans la vue sans scrollIntoView (qui ne tient pas compte
// de la colonne collante et défile parfois le mauvais conteneur).
function scrollableAncestor(el: HTMLElement, axis: "x" | "y"): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const overflow = axis === "x" ? style.overflowX : style.overflowY;
    const scrollable =
      axis === "x" ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight;
    if ((overflow === "auto" || overflow === "scroll") && scrollable) return node;
    node = node.parentElement;
  }
  return null;
}

export function HistoryGrid({ months, currentMonth, stripMin, stripMax, forecast, sections, ignoredBlocks, overspend, grand, groups, solde, planned, onSelect, selected, anchor, accountId, overspendsByMonth }: {
  months: string[];
  currentMonth: string;
  // Bornes de la frise : les mois que le calendrier du formulaire de création
  // inline d'un groupe accepte, passé compris.
  stripMin: string;
  stripMax: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  // Transactions mises hors calcul par l'utilisateur, reçus puis dépenses. Rendues
  // tout en bas, à l'écart des sections : aucun total ne les additionne.
  ignoredBlocks?: IgnoredBlock[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
  planned: PlannedSoldes;
  // Clic sur un montant : remonté au parent, qui l'affiche dans la sidebar.
  onSelect: (d: CellDetail) => void;
  // Cases actives choisies depuis le side panel (clés data-cellkey, null = aucune).
  // Plusieurs quand la ligne cliquée du panneau est une somme éclatée dans le tableau.
  selected?: string[] | null;
  // Case ancre = montant cliqué dans le tableau ; reste surligné tant que le panneau
  // est ouvert, en plus de la case active.
  anchor?: string | null;
  // Compte affiché : nécessaire au bloc de décision d'un dépassement (Task 6).
  accountId: string;
  // Décisions déjà prises sur des dépassements (groupId, mois), chargées en page.
  // Dépassements groupés par mois : l'étiquette « dépassement » sur les cases, et le
  // signal porté par un groupe récurrent dont une ligne déborde.
  overspendsByMonth?: Record<string, Overspend[]>;
}) {
  // Groupes qui ont un dépassement, par mois (clé « groupe::mois ») : un récurrent
  // replié doit le montrer sur sa propre case, faute de voir ses lignes.
  const groupeEnDepassement = useMemo(() => groupsWithPending(overspendsByMonth ?? {}), [overspendsByMonth]);
  // Le dépassement d'une case précise, pour son bandeau. La clé porte la ligne : une
  // enveloppe et une ligne de récurrent ne se confondent pas.
  const depassementDeCase = useMemo(() => {
    const m = new Map<string, Overspend>();
    for (const [mois, items] of Object.entries(overspendsByMonth ?? {})) {
      for (const it of items) m.set(`${it.groupId}::${it.lineId ?? 0}::${mois}`, it);
    }
    return m;
  }, [overspendsByMonth]);
  const noticeDe = (groupId: number, lineId: number | null) => (mois: string): OverspendNoticeInfo | null => {
    const o = depassementDeCase.get(`${groupId}::${lineId ?? 0}::${mois}`);
    if (!o || !accountId) return null;
    return { id: notificationId(accountId, o.groupId, o.lineId, mois), name: o.name, month: mois, amount: o.amount };
  };
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Section dont le formulaire de création inline est ouvert, ou null si aucun
  // (Task 5). Un seul formulaire ouvert à la fois. "principal" / "supplementary"
  // ouvrent le mini-formulaire de rémunération (Task 7), qui réutilise le même état.
  // Le mois en fait partie : chaque tableau de mois porte ses propres boutons
  // d'ajout, et sans lui le même formulaire s'ouvrirait dans tous les mois à la fois.
  type Adding = { kind: "recurring" | "envelope" | "principal" | "supplementary"; month: string };
  const [adding, setAdding] = useState<Adding | null>(null);
  // Ouvre le formulaire de cette section dans CE tableau, ou le referme si c'est
  // déjà lui qui est ouvert.
  const toggleAdding = (kind: Adding["kind"], month: string) =>
    setAdding((prev) => (prev && prev.kind === kind && prev.month === month ? null : { kind, month }));
  // Le formulaire ouvert dans ce tableau-ci, ou null : le même état sert les N mois.
  const addingHere = (month: string) => (adding?.month === month ? adding.kind : null);

  // Case active (B) choisie dans le panneau : sert au défilement et à la révélation.
  // S'il y en a plusieurs (somme), on défile vers la première.
  const activeCell = selected?.[0] ?? null;
  // Cases à surligner dans le tableau : l'ancre (A, le montant cliqué dans le tableau,
  // qui reste sélectionné tant que le panneau est ouvert) ET les cases actives (B).
  const selCellKey = useMemo(() => highlightedCells(anchor ?? null, selected ?? null), [anchor, selected]);
  // Ligne porteuse de la case active : préfixe de la clé « <ligne>::col::mois »
  // (ex. txn:<id>, subrow:<id>). Sert à retrouver les dépliages qui la révèlent.
  const selRowKey = rowKeyOf(activeCell);
  // Conteneur du tableau (display:contents) : sert à repérer, par data-cellkey, la
  // case sélectionnée pour la faire défiler dans la vue — sans être lui-même un
  // conteneur de mise en page.
  const gridRef = useRef<HTMLDivElement>(null);

  // Quels dépliages ouvrir pour révéler une ligne masquée choisie dans le panneau
  // (cf. src/lib/history-nav.ts).
  const revealOpenKeys = useMemo(() => computeRevealKeys(sections), [sections]);

  // Vers quelle case renvoie le « Solde précédent » de chaque ligne, colonne par
  // colonne (cf. src/lib/history-nav.ts).
  const prevDisplayedByCol = useMemo(
    () => computePrevDisplayed(sections, months, currentMonth, solde, planned),
    [sections, months, currentMonth, solde, planned],
  );

  // Estimé de fin du mois courant, aligné sur le tableau : Solde actuel + les
  // rémunérations restant à recevoir − les Balances vertes non nulles (le budget
  // restant, qu'on suppose dépensé d'ici la fin du mois).
  const tableEstimate = useMemo(
    () => computeTableEstimate(sections, months, currentMonth, forecast.balance),
    [sections, months, currentMonth, forecast.balance],
  );
  const estimateValue = tableEstimate?.value ?? forecast.currentEstimate;

  // Dépliage effectif = dépliage utilisateur, plus les ancêtres de la ligne
  // sélectionnée (transaction ou sous-ligne, pour la révéler sans muter l'état de
  // dépliage manuel). Dérivé plutôt que posé dans un effet : pas de setState en cascade.
  const effectiveOpen = useMemo(() => withRevealed(open, selRowKey, revealOpenKeys), [open, selRowKey, revealOpenKeys]);
  const isOpen = (k: string) => effectiveOpen.has(k);

  // Nombre de colonnes d'un tableau de mois (Catégorie + les colonnes de ce mois),
  // pour l'attribut colSpan des lignes d'espacement entre sections.
  const colsOfMonth = (m: string) => 1 + monthColumns(monthType(m, currentMonth)).length;

  // Faire défiler la case sélectionnée dans la vue (après dépliage éventuel : la
  // dépendance sur effectiveOpen relance l'effet une fois la ligne montée). On
  // défile explicitement le conteneur horizontal (CenterScroll) et le conteneur
  // vertical, plutôt que scrollIntoView, pour tenir compte de la première colonne
  // collante (sinon la case reste cachée derrière) et défiler le bon conteneur.
  useEffect(() => {
    if (!activeCell) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cellkey="${activeCell}"]`);
    if (!el) return;
    const pad = 12;

    // Horizontal : révéler la case à droite de la colonne collante de gauche.
    const hx = scrollableAncestor(el, "x");
    if (hx) {
      const cRect = hx.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const sticky = hx.querySelector<HTMLElement>("thead th.sticky, tbody td.sticky");
      const stickyW = sticky ? sticky.getBoundingClientRect().width : 0;
      const visLeft = cRect.left + stickyW;
      // behavior "auto" (instantané) : le défilement "smooth" est ignoré sur ce
      // conteneur (colonne collante), la case n'était alors jamais révélée.
      if (eRect.left < visLeft) hx.scrollBy({ left: eRect.left - visLeft - pad, behavior: "auto" });
      else if (eRect.right > cRect.right) hx.scrollBy({ left: eRect.right - cRect.right + pad, behavior: "auto" });
    }

    // Vertical : révéler la ligne dans le conteneur qui défile en hauteur.
    const vy = scrollableAncestor(el, "y");
    if (vy) {
      const cRect = vy.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      if (eRect.top < cRect.top) vy.scrollBy({ top: eRect.top - cRect.top - pad, behavior: "auto" });
      else if (eRect.bottom > cRect.bottom) vy.scrollBy({ top: eRect.bottom - cRect.bottom + pad, behavior: "auto" });
    }
  }, [activeCell, effectiveOpen]);

  // topLevel : ligne au niveau des sections (rémunérations), bande grise comme
  // les en-têtes Récurrents / Enveloppes.
  // mi : index du mois du tableau en cours de rendu (un tableau par mois).
  const renderGroup = (r: HistoryRow, mi: number, topLevel = false) => {
    const gKey = rowOpenKey(r.id);
    const selfKey = groupRow(r.id);
    const hasChildren = r.subRows.length > 0 || r.txns.length > 0;
    const gOpen = isOpen(gKey);
    // Bloc sortant (Récurrents / Enveloppes, r.direction === "out") : fond légèrement
    // teinté pour le distinguer du bloc entrant (Rémunérations) au-dessus — cf. OUT_TINT.
    const outTint = !topLevel && r.direction === "out";
    // Détail « gestion du groupe » ouvert par l'icône au survol. Le mois visé est
    // celui du tableau où on a cliqué : c'est là que prendra effet le montant de
    // départ d'une ligne ajoutée, et c'est le mois qu'on avait sous les yeux.
    // Nature et lignes viennent du SelectGroup enrichi (pas de requête
    // supplémentaire), réduites à ce qui ne dépend pas du mois : les montants ne se
    // modifient plus ici mais dans leur case (cf. BudgetEditBlock).
    const sg = groups.find((g) => g.id === r.id);
    const manageMonth = months[mi];
    const manageDetail: CellDetail = {
      title: r.name,
      nodes: [],
      result: 0,
      groupManage: {
        groupId: r.id,
        name: r.name,
        kind: sg?.kind ?? "envelope",
        month: manageMonth,
        lines: (sg?.lines ?? []).map((l) => ({ id: l.id, name: l.name, day: l.day })),
      },
    };
    return (
      <Fragment key={r.id}>
        <TableRow className={cn("group", topLevel ? "bg-muted/40 hover:bg-muted/40 font-medium" : hasChildren && "hover:bg-muted/50", outTint && OUT_TINT)}>
          <NameCell indent={0} bg={topLevel ? MUTED40 : outTint ? OUT_TINT : undefined} expandable={hasChildren} expanded={gOpen} onToggle={hasChildren ? () => toggle(gKey) : undefined}>
            {r.direction === "in" ? (
              <ArrowUpRight className="size-4 shrink-0 text-sky-600" />
            ) : (
              <ArrowDownRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate font-medium">{r.name}</span>
            {/* Gérer le groupe : icône discrète révélée au survol de la ligne. */}
            <button
              type="button"
              aria-label="Gérer le groupe"
              onClick={(e) => {
                e.stopPropagation();
                onSelect(manageDetail);
              }}
              className="text-muted-foreground hover:text-foreground ml-1 shrink-0 opacity-0 group-hover:opacity-100"
            >
              <Pencil className="size-3.5" />
            </button>
          </NameCell>
          <AmountCells
            cells={r.cells}
            mode={r.direction}
            solde={solde.rowRunning[r.id]}
            soldePrevu={planned.prevuRowRunning[r.id]}
            soldeDepass={planned.depassRowRunning[r.id]}
            onSelect={onSelect}
            subtitleOf={(i) => `${r.name} · ${monthLabel(months[i])}`}
            detailRow={r}
            months={months}
            currentMonth={currentMonth}
            rowKey={selfKey}
            selCellKey={selCellKey}
            prevDisp={{ solde: prevDisplayedByCol.solde.get(selfKey), soldePrevu: prevDisplayedByCol.soldePrevu.get(selfKey), soldeDepass: prevDisplayedByCol.soldeDepass.get(selfKey) }}
            incomeKind={r.incomeKind}
            budgetEditOf={(m) => budgetEditOfGroup(sg, m, currentMonth)}
            signaleDepassement={(m) => groupeEnDepassement.has(`${r.id}::${m}`)}
            noticeOf={noticeDe(r.id, null)}
            only={mi}
          />
        </TableRow>
        {gOpen && (
          <>
            {r.subRows.map((sub: HistorySubRow) => {
              const lKey = lineOpenKey(sub.id);
              const lOpen = isOpen(lKey);
              const subHasTxns = sub.txns.length > 0;
              // Ligne synthétisée à partir du poste : réutilise les helpers de détail
              // (budgetNodes → nœud unique, txnChildren → transactions du poste). Sans
              // subRows ni chaîne de solde, les cases Solde restent vides/non cliquables.
              const subAsRow: HistoryRow = {
                id: sub.id,
                name: sub.name,
                kind: "recurring",
                direction: r.direction,
                incomeKind: null,
                cells: sub.cells,
                // La vie propre de la ligne (sub.aliveMonths), pas celle du groupe
                // (r.aliveMonths) : une ligne ajoutée après le début d'un groupe
                // encore vivant sinon voit son repère de changement (Task 2) marquer
                // sa naissance comme une vraie hausse — voir HistorySubRow.aliveMonths.
                aliveMonths: sub.aliveMonths,
                subRows: [],
                txns: sub.txns,
              };
              const sgLine = sg?.lines.find((l) => l.id === sub.id);
              return (
                <Fragment key={sub.id}>
                  <TableRow className={cn("group text-sm", subHasTxns && "hover:bg-muted/50")}>
                    <NameCell indent={1} expandable={subHasTxns} expanded={lOpen} onToggle={subHasTxns ? () => toggle(lKey) : undefined}>
                      <span className="min-w-0 truncate">{sub.name}</span>
                      {/* Gérer la ligne : même crayon discret que sur la ligne de
                          groupe, révélé au survol. Une ligne est un poste à part
                          entière (Sosh Internet n'est pas Sosh Mobile) : on la renomme
                          là où on la voit, pas en la cherchant dans une liste. Le jour
                          suit le nom ; son montant, daté, se fixe dans sa case. */}
                      <button
                        type="button"
                        aria-label="Gérer la ligne"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect({
                            title: sub.name,
                            nodes: [],
                            result: 0,
                            // Le jour vient du SelectGroup : une HistorySubRow ne porte
                            // que des chiffres par mois, pas les propriétés de la ligne.
                            lineManage: { lineId: sub.id, name: sub.name, day: sgLine?.day ?? 1 },
                          });
                        }}
                        className="text-muted-foreground hover:text-foreground ml-1 shrink-0 opacity-0 group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    </NameCell>
                    {/* Sous-ligne (poste d'un récurrent) : cellules désormais cliquables
                        (détail dérivé du poste). Les cases Solde restent vides. */}
                    <AmountCells
                      cells={sub.cells}
                      mode={r.direction}
                      onSelect={onSelect}
                      subtitleOf={(i) => `${sub.name} · ${monthLabel(months[i])}`}
                      detailRow={subAsRow}
                      months={months}
                      currentMonth={currentMonth}
                      rowKey={subRow(sub.id)}
                      selCellKey={selCellKey}
                      incomeKind={r.incomeKind}
                      budgetEditOf={(m) => budgetEditOfLine(sgLine, m, currentMonth)}
                      signaleDepassement={(m) => depassementDeCase.has(`${r.id}::${sub.id}::${m}`)}
                      noticeOf={noticeDe(r.id, sub.id)}
                      only={mi}
                    />
                  </TableRow>
                  {lOpen && sub.txns.map((t) => (
                    <TxnRow key={t.id} txn={t} months={months} currentMonth={currentMonth} groups={groups} indent={2} onSelect={onSelect} selCellKey={selCellKey} only={mi} />
                  ))}
                </Fragment>
              );
            })}
            {r.txns.map((t) => (
              <TxnRow key={t.id} txn={t} months={months} currentMonth={currentMonth} groups={groups} indent={1} onSelect={onSelect} selCellKey={selCellKey} only={mi} />
            ))}
          </>
        )}
      </Fragment>
    );
  };

  // Ligne dédiée affichant le Reste/Manque final d'une section de dépense
  // (Récurrents / Enveloppes) en bas du tableau, dans la colonne Reste/Manque.
  // Le montant est retiré de la ligne « Total ... » et reporté ici.
  const renderSectionResteRow = (kind: "recurring" | "envelope", label: string, secs: HistorySection[], mi: number) => {
    const sec = secs.find((s) => s.kind === kind);
    if (!sec) return null;
    const rowKey = `reste:${kind}`;
    return (
      // Sous-total de section (bloc sortant) : même teinte que les lignes de groupe
      // Récurrents/Enveloppes juste au-dessus (cf. OUT_TINT).
      <TableRow className={cn("text-sm", OUT_TINT)}>
        <TableCell className={cn(OUT_TINT, "h-px p-0")}>
          <FirstColBox><span className="text-muted-foreground">{label}</span></FirstColBox>
        </TableCell>
        {months.map((m, i) => {
          if (skipMonth(mi, i)) return null;
          const type = monthType(m, currentMonth);
          const cols = monthColumns(type);
          const c = sec.totals[i];
          const subtitle = `${label} · ${monthLabel(m)}`;
          // Décomposition Budget − Dépensé (les sections de dépense vérifient l'invariant).
          const depNodes = sec.rows.map((r) => groupNode(r, i, m, "depense")).filter((n) => n.amount !== 0);
          const detail: CellDetail = makeDetail(
            "Reste",
            [
              { label: "Budget", amount: c.budgeted, ref: cellKey(sectionRow(kind), "budget", i) },
              { label: "Dépensé", amount: -c.depense, ref: cellKey(sectionRow(kind), "depense", i), children: depNodes.map(negateNode) },
            ],
            { subtitle, result: c.balance },
          );
          const resteCell = (b: boolean) => (
            <CellAmount key="reste" className={cn(b && MONTH_GAP, "text-right tabular-nums", resteColor(c.balance))} detail={detail} onSelect={onSelect} cellKey={cellKey(rowKey, "reste", i)} selCellKey={selCellKey}>
              {fmt(c.balance)}
            </CellAmount>
          );
          const slots = blankSlots();
          slots.reste = resteCell;
          return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
        })}
      </TableRow>
    );
  };

  // Ligne « Non catégorisés » d'une des deux sections (reçus / dépenses) : total
  // dépliable sur ses transactions. Les reçus s'affichent sous les rémunérations,
  // les dépenses après les enveloppes.
  const renderUncatRows = (sec: HistorySection, secs: HistorySection[], mi: number) => {
    const dir = sec.uncatDirection ?? "out";
    const uKey = uncatOpenKey(dir);
    const uOpen = isOpen(uKey);
    const hasTxns = (sec.txns?.length ?? 0) > 0;
    const rowKey = sectionRowKey(sec);
    // Valeurs courues des chaînes du plan à cette étape (calculées par
    // computePlannedSoldes dans l'ordre de lecture, débordement net déjà retiré
    // pour la ligne dépenses).
    const planPrevu = planned.uncatPrevuRunning[dir];
    const planDepass = planned.uncatDepassRunning[dir];
    return (
      <>
        <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
          <NameCell indent={0} bg={MUTED40} expandable={hasTxns} expanded={uOpen} onToggle={hasTxns ? () => toggle(uKey) : undefined}>
            <span className="min-w-0 truncate">Non catégorisés</span>
          </NameCell>
          <SectionTotalsCells
            sec={sec}
            months={months}
            currentMonth={currentMonth}
            onSelect={onSelect}
            solde={solde.uncategorizedRunning?.[dir] ?? undefined}
            planPrevu={planPrevu}
            planDepass={planDepass}
            uncatInSec={dir === "out" ? secs.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in") : undefined}
            selCellKey={selCellKey}
            prevDisp={{ solde: prevDisplayedByCol.solde.get(rowKey), soldePrevu: prevDisplayedByCol.soldePrevu.get(rowKey), soldeDepass: prevDisplayedByCol.soldeDepass.get(rowKey) }}
            noticeOf={noticeDe(0, null)}
            only={mi}
          />
        </TableRow>
        {uOpen && sec.txns?.map((t) => (
          <TxnRow key={t.id} txn={t} months={months} currentMonth={currentMonth} groups={groups} indent={1} onSelect={onSelect} selCellKey={selCellKey} only={mi} />
        ))}
      </>
    );
  };

  // Bloc « Non comptabilisées » (reçus ou dépenses) : un total dépliable sur ses
  // transactions, rendu tout en bas du tableau. Le sens se lit dans la colonne :
  // Reçu pour les entrées, Dép. pour les sorties. Ces montants ne sont additionnés
  // nulle part ailleurs — la ligne est purement informative.
  const renderIgnoredBlock = (block: IgnoredBlock, mi: number) => {
    const isIn = block.direction === "in";
    const key = `s:ignored-${block.direction}`;
    const opened = isOpen(key);
    const title = isIn ? "Non comptabilisées — Reçus" : "Non comptabilisées — Dépenses";
    const rowId = sectionRow(`ignored-${block.direction}`);
    return (
      <Fragment key={key}>
        <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
          <NameCell indent={0} bg={MUTED40} expandable expanded={opened} onToggle={() => toggle(key)}>
            <span className="min-w-0 truncate">{title}</span>
          </NameCell>
          {months.map((m, i) => {
            if (skipMonth(mi, i)) return null;
            const val = isIn ? block.totals[i].recu : block.totals[i].depense;
            const nodes = block.txns
              .filter((t) => t.month === m)
              .map((t) => txnNode(t.date, t.label, Math.abs(t.amount), cellKey(txnRow(t.id), isIn ? "recu" : "depense", i)));
            const detail: CellDetail | null =
              val > 0.005 ? makeDetail(title, nodes, { subtitle: monthLabel(m), result: val }) : null;
            const cell = (b: boolean) => (
              <CellAmount
                key="ignored"
                className={cn(b && MONTH_GAP, "text-right tabular-nums text-muted-foreground")}
                detail={detail}
                onSelect={onSelect}
                cellKey={cellKey(rowId, isIn ? "recu" : "depense", i)}
                selCellKey={selCellKey}
              >
                {val > 0.005 ? fmt(val) : ""}
              </CellAmount>
            );
            const slots = blankSlots();
            if (isIn) slots.recu = cell;
            else slots.dep = cell;
            const cols = monthColumns(monthType(m, currentMonth));
            return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
          })}
        </TableRow>
        {opened &&
          block.txns.map((t) => (
            <TxnRow
              key={t.id}
              txn={t}
              months={months}
              currentMonth={currentMonth}
              groups={groups}
              indent={1}
              onSelect={onSelect}
              selCellKey={selCellKey}
              ignored
              only={mi}
            />
          ))}
      </Fragment>
    );
  };

  // Un tableau pour un mois. Les données restent indexées sur la frise entière (mi
  // est l'index du mois) : seules les lignes changent, pas les repères.
  const monthTable = (m: string, mi: number) => {
    // La colonne de gauche de CE mois : les groupes qui y vivent, et leurs
    // transactions de ce mois-là. C'est toute la raison d'être des tableaux séparés.
    const secs = sectionsAtMonth(sections, mi, m);
    const totalCols = colsOfMonth(m);
    return (
    <>
    {/* w-max : la largeur du tableau suit son contenu, pas le conteneur. Sinon
        (w-full par defaut) les colonnes se resserrent quand la sidebar de detail
        s'ouvre et retrecit la zone : le tableau doit defiler, pas se tasser. */}
    {/* font-mono sur TOUT le tableau : le défaut ici, c'est le chiffre. Les rares
        zones de texte (première colonne, en-têtes) repassent en font-sans. 13px
        compense la chasse fixe, plus large que la proportionnelle, pour garder la
        même densité horizontale. */}
    {/* [&_td]:align-top : une Balance en dépassement porte son étiquette SOUS le
        montant, donc sa cellule est plus haute que les autres. Avec l'alignement
        vertical centré par défaut, le montant remonterait de quelques pixels par
        rapport aux chiffres du reste de la ligne. Calés en haut, tous les nombres
        d'une même ligne restent sur la même ligne de base ; les lignes sans
        étiquette, qui tiennent sur une seule ligne, ne bougent pas. */}
    <Table className="w-max font-mono text-[13px] [&_td]:align-top">
      {/* Teinte de fond des colonnes (posée sous le fond des lignes) : par nature du
          mois (passé / courant / premier mois futur) sur tout le bloc du mois, sinon
          repli sur la teinte neutre des colonnes de solde pour les mois futurs suivants. */}
      <colgroup>
        <col />
        {monthColumns(monthType(m, currentMonth)).map((col) => (
          <col
            key={`${m}-${col}`}
            className={cn(SOLDE_TINTS[col] ?? monthTint(m, mi, months, currentMonth))}
          />
        ))}
      </colgroup>
      <TableHeader>
        <TableRow>
          {/* Centré comme les noms de mois : cette cellule couvre les deux rangées
              d'en-tête, elle se cale donc au milieu de l'ensemble. */}
          <TableHead rowSpan={2} className="bg-background h-px p-0 align-middle">
            <FirstColBox>Catégorie</FirstColBox>
          </TableHead>
          {[m].map((m) => {
            const cols = monthColumns(monthType(m, currentMonth));
            return (
              <TableHead
                key={m}
                colSpan={cols.length}
                data-current-month={m === currentMonth ? "" : undefined}
                className={cn(
                  MONTH_GAP,
                  // align-middle et non align-bottom : les mois de projection portent
                  // une mention sous leur nom, donc ils sont plus hauts, et c'est eux
                  // qui fixent la hauteur de la rangée. Alignés en bas, les autres mois
                  // se retrouvaient plaqués en bas avec du vide au-dessus.
                  // pr-5 en écho au pl-5 de MONTH_GAP : sans ça le retrait de
                  // séparation décentrerait le nom du mois au-dessus de son bloc.
                  "py-2 pr-5 text-center whitespace-nowrap align-middle",
                  m > currentMonth && "text-muted-foreground",
                )}
              >
                {/* Le mois en serif, l'année en chasse fixe et en retrait : le mois
                    est un titre de chapitre, l'année une donnée de repérage. Le mois
                    courant est le seul à porter l'encre pleine et un filet sous son
                    nom — plus lisible qu'un simple gras au milieu de douze colonnes. */}
                <div className="flex items-baseline justify-center gap-1.5">
                  <span
                    className={cn(
                      "font-display text-[15px] leading-none",
                      m === currentMonth && "text-foreground decoration-foreground/40 underline decoration-1 underline-offset-[6px]",
                    )}
                  >
                    {monthName(m)}
                  </span>
                  <span className="text-muted-foreground/70 font-mono text-[11px] leading-none">
                    {m.slice(0, 4)}
                  </span>
                </div>
                {m > currentMonth && (
                  <div className="text-muted-foreground/60 mt-1 font-sans text-[9px] font-normal tracking-[0.16em] uppercase">
                    projection
                  </div>
                )}
              </TableHead>
            );
          })}
        </TableRow>
        <TableRow>
          {[m].map((m) => {
            const type = monthType(m, currentMonth);
            const cols = monthColumns(type);
            return (
              <Fragment key={m}>
                {/* Micro-typographie : capitales espacées, petites et grises. Le
                    libellé d'une colonne est une étiquette, pas un contenu — il doit
                    s'effacer devant les chiffres qu'il coiffe tout en restant net. */}
                {cols.map((col, idx) => (
                  <TableHead
                    key={col}
                    className={cn(
                      col === "reste" ? BALANCE_TINT : SOLDE_TINTS[col],
                      idx === 0 && MONTH_GAP,
                      "text-muted-foreground h-auto py-1.5 text-right align-bottom font-sans text-[10px] font-medium tracking-[0.09em] uppercase",
                    )}
                  >
                    {/* Cliquer l'en-tête ouvre l'explication de la colonne dans le panneau. */}
                    <button
                      type="button"
                      onClick={() => onSelect(makeInfo(COL_LABEL[col], COL_INFO[col]))}
                      className="hover:text-foreground cursor-pointer decoration-dotted underline-offset-2 hover:underline"
                    >
                      {COL_LABEL[col]}
                    </button>
                  </TableHead>
                ))}
              </Fragment>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
          <TableCell className={cn("h-px p-0", MUTED40)}>
            <FirstColBox>Argent de départ</FirstColBox>
          </TableCell>
          {solde.openings.map((v, i) => {
            if (skipMonth(mi, i)) return null;
            // 1er mois affiché : reconstitué en rembobinant depuis le solde réel de
            // la banque (forecast.balance = a.balance, l'ancre de computeSolde).
            // Mois suivants : hérité du solde de clôture du mois précédent.
            const detail: CellDetail =
              i === 0
                ? makeDetail(
                    "Argent de départ",
                    [
                      { label: "Solde du compte (banque)", amount: forecast.balance },
                      { label: "Mouvements de la période (rembobinés)", amount: solde.openings[0] - forecast.balance },
                    ],
                    {
                      subtitle: monthLabel(months[0]),
                      result: solde.openings[0],
                      note: "Reconstitué en rembobinant les mouvements depuis le solde réel de la banque.",
                    },
                  )
                : months[i - 1] === currentMonth && months[i] > currentMonth
                  ? // Premier mois futur : il s'ouvre sur l'estimé de fin du mois courant.
                    makeDetail(
                      "Argent de départ",
                      [{ label: "Estimé fin du mois précédent", amount: solde.openings[i], ref: cellKey("estime", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: solde.openings[i] },
                    )
                  : makeDetail(
                      "Argent de départ",
                      [{ label: "Solde de fin du mois précédent", amount: solde.closings[i - 1], ref: cellKey("grand", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: solde.openings[i] },
                    );
            const type = monthType(months[i], currentMonth);
            const cols = monthColumns(type);
            // L'ouverture est commune aux trois chaînes au mois courant. En
            // projection, l'ouverture d'une chaîne = clôture (prévue / si dépassement)
            // du mois précédent ; repli sur l'argent de départ réel au 1er mois.
            // Mois passés et courant : le plan s'ancre sur l'ouverture réelle du mois.
            // Premier mois futur : les deux chaînes repartent de l'estimé de fin du
            // mois courant. Mois futurs suivants : elles enchaînent sur la clôture
            // (prévue / si dépassement) du mois précédent.
            const firstFuture = months[i] > currentMonth && i > 0 && months[i - 1] === currentMonth;
            const prevuOpen =
              months[i] <= currentMonth ? v
              : firstFuture ? estimateValue
              : i > 0 && planned.prevuClosings[i - 1] != null ? planned.prevuClosings[i - 1] : v;
            const depassOpen =
              months[i] <= currentMonth ? v
              : firstFuture ? estimateValue
              : i > 0 && planned.depassClosings[i - 1] != null ? planned.depassClosings[i - 1] : v;
            const openingCell = (b: boolean) => (
              <CellAmount key="soldeReel" className={cn(b && MONTH_GAP, "text-right tabular-nums", soldeColor(v))} detail={detail} onSelect={onSelect} cellKey={cellKey(openingRow, "solde", i)} selCellKey={selCellKey}>
                {fmt(v)}
              </CellAmount>
            );
            // Détail des ouvertures de plan : sur un mois passé ou courant, l'ouverture
            // prévue / si dépassement vaut l'argent de départ réel (même détail). En
            // projection, elle vaut la clôture (prévue / si dépassement) du mois passé.
            const prevuOpenDetail: CellDetail =
              months[i] <= currentMonth
                ? detail
                : firstFuture
                  ? makeDetail(
                      "Argent de départ",
                      [{ label: "Estimé fin du mois précédent", amount: prevuOpen ?? 0, ref: cellKey("estime", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: prevuOpen ?? 0 },
                    )
                  : makeDetail(
                      "Argent de départ",
                      [{ label: "Solde prévu de fin du mois précédent", amount: prevuOpen ?? 0, ref: i > 0 ? cellKey("grand", "soldePrevu", i - 1) : undefined }],
                      { subtitle: monthLabel(months[i]), result: prevuOpen ?? 0 },
                    );
            const depassOpenDetail: CellDetail =
              months[i] <= currentMonth
                ? detail
                : firstFuture
                  ? makeDetail(
                      "Argent de départ",
                      [{ label: "Estimé fin du mois précédent", amount: depassOpen ?? 0, ref: cellKey("estime", "solde", i - 1) }],
                      { subtitle: monthLabel(months[i]), result: depassOpen ?? 0 },
                    )
                  : makeDetail(
                      "Argent de départ",
                      [{ label: "Solde de fin du mois précédent (si dépassement)", amount: depassOpen ?? 0, ref: i > 0 ? cellKey("grand", "soldeDepass", i - 1) : undefined }],
                      { subtitle: monthLabel(months[i]), result: depassOpen ?? 0 },
                    );
            const slots = blankSlots();
            slots.soldeReel = openingCell;
            slots.soldePrevu = (b) => plannedSoldeCell("soldePrevu", prevuOpen, b, prevuOpenDetail, onSelect, cellKey(openingRow, "soldePrevu", i), selCellKey);
            slots.soldeDepass = (b) => plannedSoldeCell("soldeDepass", depassOpen, b, depassOpenDetail, onSelect, cellKey(openingRow, "soldeDepass", i), selCellKey);
            return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
          })}
        </TableRow>
        {secs.map((sec, si) => {
          // Un petit espace sépare chaque section de la précédente.
          const spacer = si > 0 ? <SpacerRow cols={totalCols} /> : null;
          if (sec.kind === "income") {
            // Rémunérations : lignes au niveau des sections, tout en haut, puis les
            // reçus non catégorisés, puis une ligne « Total rémunérations »
            // (principale + supplémentaire). L'en-tête n'affiche un bouton
            // d'ajout (Task 7) que pour les types encore absents du compte —
            // au plus une principale et une supplémentaire.
            const uncatIn = secs.find((s) => s.kind === "uncategorized" && s.uncatDirection === "in");
            const hasPrincipal = sec.rows.some((r) => r.incomeKind === "principal");
            const hasSupplementary = sec.rows.some((r) => r.incomeKind === "supplementary");
            return (
              <Fragment key={sec.kind}>
                {spacer}
                {(!hasPrincipal || !hasSupplementary) && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={totalCols} className="p-0">
                      <div className="font-sans bg-background flex w-fit items-center gap-3 py-0.5 pr-3 pl-1">
                        {!hasPrincipal && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => toggleAdding("principal", m)}
                          >
                            <Plus />
                            Rémunération principale
                          </Button>
                        )}
                        {!hasSupplementary && (
                          <Button
                            type="button"
                            size="xs"
                            variant="outline"
                            onClick={() => toggleAdding("supplementary", m)}
                          >
                            <Plus />
                            Rémunération supplémentaire
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {(addingHere(m) === "principal" || addingHere(m) === "supplementary") && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={totalCols} className="p-0">
                      <div className="font-sans bg-background w-fit">
                        <NewRemunerationInline
                          accountId={accountId}
                          incomeKind={addingHere(m) as "principal" | "supplementary"}
                          onDone={() => setAdding(null)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {sec.rows.map((r) => renderGroup(r, mi, true))}
                {uncatIn && renderUncatRows(uncatIn, secs, mi)}
                <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                  <TableCell className={cn("h-px p-0", MUTED40)}>
                    <FirstColBox>Total rémunérations</FirstColBox>
                  </TableCell>
                  <IncomeTotalCells sec={sec} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} only={mi} />
                </TableRow>
              </Fragment>
            );
          }
          if (sec.kind === "uncategorized") {
            // Les reçus non catégorisés sont rendus dans la section Rémunérations
            // (ci-dessus) quand elle existe ; sinon ils s'affichent ici, à leur place.
            if (sec.uncatDirection === "in" && secs.some((s) => s.kind === "income")) return null;
            return (
              <Fragment key={`uncat-${sec.uncatDirection ?? "out"}`}>
                {spacer}
                {renderUncatRows(sec, secs, mi)}
              </Fragment>
            );
          }
          // Récurrents / Enveloppes : un titre de section avec un bouton d'ajout
          // inline (Task 5), puis les lignes, puis une ligne de total en bas
          // (« Total Récurrents » / « Total Enveloppes »), comme les rémunérations.
          const sectionKind = sec.kind as "recurring" | "envelope";
          return (
            <Fragment key={sec.kind}>
              {spacer}
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={totalCols} className="p-0">
                  <div className="font-sans bg-background flex w-fit items-center py-1 pr-3 pl-1">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => toggleAdding(sectionKind, m)}
                    >
                      <Plus />
                      {labelOfSection(sectionKind)}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              {addingHere(m) === sectionKind && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={totalCols} className="p-0">
                    <div className="font-sans bg-background w-fit">
                      {/* Créé depuis le tableau d'un mois : ce mois-là est proposé
                          d'emblée comme mois de départ. */}
                      <NewGroupInline
                        accountId={accountId}
                        kind={sectionKind}
                        stripMin={stripMin}
                        stripMax={stripMax}
                        defaultMonth={m}
                        onDone={() => setAdding(null)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {sec.rows.map((r) => renderGroup(r, mi))}
              <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                <TableCell className={cn("h-px p-0", MUTED40)}>
                  <FirstColBox>{sec.kind === "envelope" ? "Total Enveloppes" : "Total Récurrents"}</FirstColBox>
                </TableCell>
                <SectionTotalsCells sec={sec} months={months} currentMonth={currentMonth} onSelect={onSelect} selCellKey={selCellKey} only={mi} />
              </TableRow>
              {renderSectionResteRow(sec.kind, sec.kind === "envelope" ? "Balance enveloppes" : "Balance récurrents", secs, mi)}
            </Fragment>
          );
        })}
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="h-px bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Solde actuel</FirstColBox>
          </TableCell>
          <GrandTotalsCells sections={secs} grand={grand} solde={solde} planned={planned} months={months} currentMonth={currentMonth} currentEstimate={estimateValue} onSelect={onSelect} selCellKey={selCellKey} only={mi} />
        </TableRow>
        {/* Estimé fin de mois : mois courant = Solde actuel + rémunérations restant
            à recevoir − Balances vertes (le budget restant, supposé dépensé d'ici la
            fin du mois) ; autres mois = leur solde de clôture (même détail que la
            ligne « Solde actuel » pour ce mois — cf. soldeActuelDetail). */}
        <TableRow className="text-sm">
          <TableCell className="bg-background h-px p-0">
            <FirstColBox><span className="text-muted-foreground">Estimé fin de mois</span></FirstColBox>
          </TableCell>
          {months.map((m, i) => {
            if (skipMonth(mi, i)) return null;
            const isCurrent = m === currentMonth;
            const v = isCurrent ? estimateValue : solde.closings[i];
            const detail: CellDetail = isCurrent
              ? makeDetail(
                  "Estimé fin de mois",
                  [
                    { label: "Solde actuel", amount: forecast.balance, ref: cellKey("grand", "solde", i) },
                    ...(tableEstimate?.incomeSteps ?? []).map((s): DetailNode => ({
                      label: `${s.name} — reste à recevoir`,
                      amount: s.amount,
                      ref: cellKey(groupRow(s.id), "revenus", i),
                    })),
                    ...(tableEstimate?.spendSteps ?? []).map((s): DetailNode => ({
                      label: `${s.name} — reste à dépenser`,
                      amount: -s.amount,
                      ref: cellKey(groupRow(s.id), "reste", i),
                    })),
                  ],
                  { subtitle: monthLabel(m), result: v },
                )
              : soldeActuelDetail(secs, solde, i, m, { title: "Estimé fin de mois", result: solde.closings[i] });
            const type = monthType(m, currentMonth);
            const cols = monthColumns(type);
            const estCell = (b: boolean) => (
              <CellAmount key="est" className={cn(b && MONTH_GAP, "text-right tabular-nums", soldeColor(v))} detail={detail} onSelect={onSelect} cellKey={cellKey("estime", "solde", i)} selCellKey={selCellKey}>
                {fmt(v)}
              </CellAmount>
            );
            const slots = blankSlots();
            // Sur les mois de projection, l'« Estimé fin de mois » répéterait le
            // « Solde réel » (Solde actuel) déjà affiché plus haut : on laisse vide.
            if (m <= currentMonth) slots.soldeReel = estCell;
            return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
          })}
        </TableRow>
        {/* Dépassement final du mois : somme des montants rouges de la colonne
            Balance (groupes qui débordent + Non catégorisés), hors lignes
            « Balance récurrents / enveloppes » qui agrègent déjà ces montants. */}
        <TableRow className="text-sm">
          <TableCell className="bg-background h-px p-0">
            <FirstColBox><span className="text-muted-foreground">Dépassement hors budget</span></FirstColBox>
          </TableCell>
          {months.map((m, i) => {
            if (skipMonth(mi, i)) return null;
            // Part rouge de la Balance des non catégorisés (ligne dépenses) = dépensé
            // au-delà des reçus non catégorisés (la ligne du haut).
            const uncatDep = uncatOverspend(secs, i);
            const val = overspend[i] + uncatDep;
            const nodes: DetailNode[] = [
              ...secs
                .flatMap((s) => s.rows)
                .filter((r) => r.direction === "out" && r.cells[i].balance < -0.005)
                .map((r): DetailNode => ({ label: r.name, amount: -r.cells[i].balance, ref: cellKey(groupRow(r.id), "reste", i) })),
              ...(uncatDep > 0.005
                ? [{ label: "Non catégorisés", amount: uncatDep, ref: cellKey(sectionRow("uncategorized"), "reste", i) }]
                : []),
            ];
            const detail: CellDetail | null =
              val > 0.005 ? makeDetail("Dépassement hors budget", nodes, { subtitle: monthLabel(m), result: val }) : null;
            const type = monthType(m, currentMonth);
            const cols = monthColumns(type);
            const depCell = (b: boolean) => (
              <CellAmount key="overspend" className={cn(b && MONTH_GAP, "text-right tabular-nums", val > 0.005 && "text-red-600")} detail={detail} onSelect={onSelect} cellKey={cellKey("overspend", "reste", i)} selCellKey={selCellKey}>
                {val > 0.005 ? fmt(val) : ""}
              </CellAmount>
            );
            const slots = blankSlots();
            slots.reste = depCell;
            return <Fragment key={i}>{renderCols(cols, slots, monthTint(months[i], i, months, currentMonth))}</Fragment>;
          })}
        </TableRow>
        {/* Transactions mises hors calcul : affichées pour mémoire, en dehors de
            toute somme. Elles arrivent après les lignes de solde, justement pour
            qu'on voie qu'elles ne participent à rien de ce qui précède. */}
        {(ignoredBlocks?.length ?? 0) > 0 && (
          <>
            <SpacerRow cols={totalCols} />
            {ignoredBlocks!.map((b) => renderIgnoredBlock(b, mi))}
          </>
        )}
      </TableBody>
    </Table>
    </>
    );
  };

  return (
    // Un tableau par mois, légèrement espacés, dans le défilement horizontal
    // habituel. w-max : la rangée fait la largeur de ses tableaux, elle ne se tasse
    // pas quand le panneau de détail s'ouvre.
    // Ce conteneur sert aussi d'ancre pour retrouver, par data-cellkey, la case
    // sélectionnée à faire défiler dans la vue.
    <div ref={gridRef} className="flex w-max items-start gap-6">
      {months.map((m, mi) => (
        <div key={m}>{monthTable(m, mi)}</div>
      ))}
    </div>
  );
}
