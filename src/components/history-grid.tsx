"use client";
import { Fragment, useState } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { monthLabel } from "@/lib/transactions-view";
import type { AccountForecast } from "@/lib/forecast";
import { type MonthCell, type HistorySection, type HistoryRow, type HistorySubRow, type HistoryTxn, type SoldeColumn } from "@/lib/history";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TruncatedText } from "@/components/truncated-text";
import { GroupSelectField } from "@/components/group-select-field";
import { HistoryDetailSidebar } from "@/components/history-detail-sidebar";
import { type CellDetail, type DetailNode, makeDetail, txnNode } from "@/lib/history-explain";

// Groupes du compte, pour le menu de (ré)assignation sur chaque transaction.
type SelectGroup = { id: number; name: string; lines: { id: number; name: string }[] };
const MUTED40 = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";

// NB (Task 4) : le libellé par section (« Rémunérations », « Récurrents »…) utilisé
// pour le détail de « Solde actuel » a été retiré ici, non-utilisé pour cette task ;
// à réintroduire si Task 4 construit un CellDetail pour cette ligne de synthèse.

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => NUM.format(Math.abs(n) < 0.005 ? 0 : n).replace(/[  ]/g, " ");

// Largeur fixe de la première colonne. Un conteneur interne à largeur px fixe
// (et non un max-width sur la cellule, ignoré en table-auto) garantit que la
// colonne ne bouge pas quand on déroule des transactions à long libellé.
const COL1_W = 320;

// Boîte à largeur fixe placée dans la cellule de gauche. Le retrait (indent) est
// appliqué à l'intérieur, donc toutes les cellules gardent la même largeur.
function FirstColBox({ children, indent = 0 }: { children: React.ReactNode; indent?: number }) {
  return (
    <div
      className="flex items-center gap-1.5 overflow-hidden py-2 pr-2"
      style={{ width: COL1_W, paddingLeft: `${0.5 + indent * 1.25}rem` }}
    >
      {children}
    </div>
  );
}

// Cellule de montant : cliquable (sélection → sidebar) si un détail est fourni.
function CellAmount({ children, className, detail, onSelect, selected }: {
  children: React.ReactNode;
  className?: string;
  detail?: CellDetail | null;
  onSelect?: (d: CellDetail) => void;
  selected?: boolean;
}) {
  if (!detail || !onSelect) return <TableCell className={className}>{children}</TableCell>;
  return (
    <TableCell className={cn(className, selected && "bg-muted ring-primary/40 ring-1 ring-inset")}>
      <button
        type="button"
        onClick={() => onSelect(detail)}
        className="cursor-pointer decoration-dotted underline-offset-2 hover:underline"
      >
        {children}
      </button>
    </TableCell>
  );
}

// Transactions d'un groupe (et de ses lignes) pour un mois → nœuds feuilles signés.
// sign = +1 pour un contexte « addition » (ex. colonne Dépensé/Reçu prise positivement),
//        -1 pour un contexte « soustraction » (ex. sous-nœud Dépensé d'un Reste).
// Définie au niveau du module (et non dans HistoryGrid comme suggéré par le brief) car
// AmountCells — qui en a besoin — est lui-même un composant de module, pas imbriqué.
function txnChildren(r: HistoryRow, month: string, sign: 1 | -1): DetailNode[] | undefined {
  const all = [...r.txns, ...r.subRows.flatMap((s) => s.txns)].filter((t) => t.month === month);
  if (all.length === 0) return undefined;
  return all.map((t) => txnNode(t.date, t.label, sign * Math.abs(t.amount)));
}

// Postes (lignes) d'un récurrent pour un mois → nœuds « Budget ». undefined si le
// groupe n'a pas de lignes (enveloppe) ou si tous les postes sont à 0 pour ce mois.
function budgetNodes(r: HistoryRow, i: number): DetailNode[] | undefined {
  if (r.subRows.length === 0) return undefined;
  const nodes = r.subRows.map((s) => ({ label: s.name, amount: s.cells[i].budgeted })).filter((n) => n.amount !== 0);
  return nodes.length > 0 ? nodes : undefined;
}

// mode : "out" (dépense), "in" (entrée) ou "total" (sous-total, montre les deux
// colonnes). La colonne Solde affiche le solde du compte cumulé, fourni par
// `solde` (une valeur par mois) ; absente ou null => cellule vide.
// detailRow : ligne de groupe (transactions/postes) permettant de construire le
// détail cliquable des cellules. Absente pour les sous-lignes et les lignes de
// synthèse (Task 4) : ces cellules restent alors non cliquables.
function AmountCells({ cells, mode, solde, onSelect, subtitleOf, detailRow, months }: {
  cells: MonthCell[];
  mode: "out" | "in" | "total";
  solde?: (number | null)[];
  onSelect?: (d: CellDetail) => void;
  subtitleOf?: (i: number) => string;
  detailRow?: HistoryRow;
  months: string[];
}) {
  return (
    <>
      {cells.map((c, i) => {
        const month = months[i];
        const subtitle = subtitleOf?.(i);
        const r = detailRow;

        const budgetDetail: CellDetail | null = (() => {
          if (mode === "in" || c.budgeted === 0 || !r) return null;
          const nodes = budgetNodes(r, i);
          return nodes ? makeDetail("Budget", nodes, { subtitle, result: c.budgeted }) : null;
        })();

        const depDetail: CellDetail | null = (() => {
          if (mode === "in" || c.depense === 0 || !r) return null;
          const nodes = txnChildren(r, month, 1);
          return nodes ? makeDetail("Dépensé", nodes, { subtitle, result: c.depense }) : null;
        })();

        const recuDetail: CellDetail | null = (() => {
          if (mode === "out" || c.recu === 0 || !r) return null;
          const nodes = txnChildren(r, month, 1);
          return nodes ? makeDetail("Reçu", nodes, { subtitle, result: c.recu }) : null;
        })();

        const resteDetail: CellDetail | null =
          mode !== "in" && r && Math.abs(c.budgeted - c.depense - c.balance) < 0.005
            ? makeDetail(
                "Reste",
                [
                  { label: "Budget", amount: c.budgeted },
                  { label: "Dépensé", amount: -c.depense, children: txnChildren(r, month, -1) },
                ],
                { subtitle, result: c.balance },
              )
            : null;

        const s = solde?.[i];
        const net = c.recu - c.depense;
        // Solde précédent = solde de cette ligne − son propre mouvement.
        const soldeDetail: CellDetail | null =
          s != null && r
            ? makeDetail(
                "Solde",
                [
                  { label: "Solde précédent", amount: s - net },
                  { label: "Mouvement du mois", amount: net, children: txnChildren(r, month, net < 0 ? -1 : 1) },
                ],
                { subtitle, result: s },
              )
            : null;

        return (
          <Fragment key={i}>
            <CellAmount className="border-l text-right tabular-nums text-muted-foreground" detail={budgetDetail} onSelect={onSelect}>
              {mode === "in" ? "" : fmt(c.budgeted)}
            </CellAmount>
            <CellAmount className="text-right tabular-nums" detail={depDetail} onSelect={onSelect}>
              {mode === "in" ? "—" : fmt(c.depense)}
            </CellAmount>
            <CellAmount className="text-right tabular-nums" detail={recuDetail} onSelect={onSelect}>
              {mode === "out" ? "—" : fmt(c.recu)}
            </CellAmount>
            <CellAmount
              className={cn("text-right tabular-nums", mode !== "in" && c.balance < 0 && "text-red-600")}
              detail={resteDetail}
              onSelect={onSelect}
            >
              {mode === "in" ? "" : fmt(c.balance)}
            </CellAmount>
            <CellAmount
              className={cn("text-right tabular-nums", s != null && s < -0.005 && "text-red-600")}
              detail={soldeDetail}
              onSelect={onSelect}
            >
              {s != null ? fmt(s) : ""}
            </CellAmount>
          </Fragment>
        );
      })}
    </>
  );
}

// Cellules d'une transaction : son montant tombe dans la colonne Dép. (sortie)
// ou Reçu (entrée), selon son signe, du mois où elle a lieu ; le reste est vide.
function TxnCells({ txn, months }: { txn: HistoryTxn; months: string[] }) {
  const isOut = txn.amount < 0;
  return (
    <>
      {months.map((m, i) => {
        const here = txn.month === m;
        const val = here ? fmt(Math.abs(txn.amount)) : "";
        return (
          <Fragment key={i}>
            <TableCell className="border-l" />
            <TableCell className="text-right tabular-nums text-muted-foreground">{here && isOut ? val : ""}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{here && !isOut ? val : ""}</TableCell>
            <TableCell />
            <TableCell />
          </Fragment>
        );
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
      className={cn(bg, "sticky left-0 z-10 p-0", expandable && "cursor-pointer")}
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
function TxnRow({ txn, months, groups, indent }: {
  txn: HistoryTxn;
  months: string[];
  groups: SelectGroup[];
  indent: number;
}) {
  return (
    <TableRow className="align-top text-sm text-muted-foreground">
      <TableCell className="bg-background sticky left-0 z-10 p-0">
        <div
          className="flex flex-col gap-1 py-2 pr-2"
          style={{ width: COL1_W, paddingLeft: `${0.5 + indent * 1.25}rem` }}
        >
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="shrink-0 tabular-nums">{txn.date}</span>
            <TruncatedText text={txn.label} className="min-w-0 flex-1" />
          </div>
          <GroupSelectField
            txnId={txn.id}
            groups={groups}
            defaultGroupId={txn.groupId}
            defaultLineId={txn.lineId}
          />
        </div>
      </TableCell>
      <TxnCells txn={txn} months={months} />
    </TableRow>
  );
}

export function HistoryGrid({ months, currentMonth, forecast, sections, overspend, grand, groups, solde }: {
  months: string[];
  currentMonth: string;
  forecast: AccountForecast;
  sections: HistorySection[];
  overspend: number[];
  grand: MonthCell[];
  groups: SelectGroup[];
  solde: SoldeColumn;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const isOpen = (k: string) => open.has(k);
  const toggle = (k: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // Détail sélectionné (clic sur un montant) → affiché dans la sidebar fixe.
  const [selected, setSelected] = useState<CellDetail | null>(null);
  const onSelect = (d: CellDetail) => setSelected(d);

  // topLevel : ligne au niveau des sections (rémunérations), bande grise comme
  // les en-têtes Récurrents / Enveloppes.
  const renderGroup = (r: HistoryRow, topLevel = false) => {
    const gKey = `g:${r.id}`;
    const hasChildren = r.subRows.length > 0 || r.txns.length > 0;
    const gOpen = isOpen(gKey);
    return (
      <Fragment key={r.id}>
        <TableRow className={cn(topLevel ? "bg-muted/40 hover:bg-muted/40 font-medium" : hasChildren && "hover:bg-muted/50")}>
          <NameCell indent={0} bg={topLevel ? MUTED40 : undefined} expandable={hasChildren} expanded={gOpen} onToggle={hasChildren ? () => toggle(gKey) : undefined}>
            {r.direction === "in" ? (
              <ArrowUpRight className="size-4 shrink-0 text-sky-600" />
            ) : (
              <ArrowDownRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate font-medium">{r.name}</span>
          </NameCell>
          <AmountCells
            cells={r.cells}
            mode={r.direction}
            solde={solde.rowRunning[r.id]}
            onSelect={onSelect}
            subtitleOf={(i) => `${r.name} · ${monthLabel(months[i])}`}
            detailRow={r}
            months={months}
          />
        </TableRow>
        {gOpen && (
          <>
            {r.subRows.map((sub: HistorySubRow) => {
              const lKey = `l:${sub.id}`;
              const lOpen = isOpen(lKey);
              const subHasTxns = sub.txns.length > 0;
              return (
                <Fragment key={sub.id}>
                  <TableRow className={cn("text-sm", subHasTxns && "hover:bg-muted/50")}>
                    <NameCell indent={1} expandable={subHasTxns} expanded={lOpen} onToggle={subHasTxns ? () => toggle(lKey) : undefined}>
                      <span className="min-w-0 truncate">{sub.name}</span>
                    </NameCell>
                    {/* Sous-ligne (poste d'un récurrent) : non cliquable pour cette task
                        (txnChildren attend un HistoryRow ; une adaptation pour HistorySubRow
                        est laissée à la Task 4 si souhaité). */}
                    <AmountCells cells={sub.cells} mode={r.direction} months={months} />
                  </TableRow>
                  {lOpen && sub.txns.map((t) => (
                    <TxnRow key={t.id} txn={t} months={months} groups={groups} indent={2} />
                  ))}
                </Fragment>
              );
            })}
            {r.txns.map((t) => (
              <TxnRow key={t.id} txn={t} months={months} groups={groups} indent={1} />
            ))}
          </>
        )}
      </Fragment>
    );
  };

  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead rowSpan={2} className="bg-background sticky left-0 z-10 p-0 align-bottom">
            <FirstColBox>Catégorie</FirstColBox>
          </TableHead>
          {months.map((m) => (
            <TableHead
              key={m}
              colSpan={5}
              data-current-month={m === currentMonth ? "" : undefined}
              className={cn(
                "border-l text-center whitespace-nowrap",
                m === currentMonth && "text-foreground font-semibold",
                m > currentMonth && "text-muted-foreground italic",
              )}
            >
              {monthLabel(m)}
              {m > currentMonth ? " · projection" : ""}
            </TableHead>
          ))}
        </TableRow>
        <TableRow>
          {months.map((m) => (
            <Fragment key={m}>
              <TableHead className="border-l text-right">Budg.</TableHead>
              <TableHead className="text-right">Dép.</TableHead>
              <TableHead className="text-right">Reçu</TableHead>
              <TableHead className="text-right">Reste</TableHead>
              <TableHead className="text-right">Solde</TableHead>
            </Fragment>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
          <TableCell className={cn("sticky left-0 z-10 p-0", MUTED40)}>
            <FirstColBox>Argent de départ</FirstColBox>
          </TableCell>
          {solde.openings.map((v, i) => (
            <Fragment key={i}>
              <TableCell className="border-l" />
              <TableCell />
              <TableCell />
              <TableCell />
              {/* Non cliquable pour cette task (ligne de synthèse, cf. Task 4). */}
              <TableCell className={cn("text-right tabular-nums", v < -0.005 && "text-red-600")}>
                {fmt(v)}
              </TableCell>
            </Fragment>
          ))}
        </TableRow>
        {sections.map((sec) => {
          if (sec.kind === "income") {
            // Rémunérations : lignes au niveau des sections, tout en haut, sans en-tête.
            return <Fragment key={sec.kind}>{sec.rows.map((r) => renderGroup(r, true))}</Fragment>;
          }
          if (sec.kind === "uncategorized") {
            const uKey = "s:uncat";
            const uOpen = isOpen(uKey);
            const hasTxns = (sec.txns?.length ?? 0) > 0;
            return (
              <Fragment key={sec.kind}>
                <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                  <NameCell indent={0} bg={MUTED40} expandable={hasTxns} expanded={uOpen} onToggle={hasTxns ? () => toggle(uKey) : undefined}>
                    <span className="min-w-0 truncate">Non catégorisés</span>
                  </NameCell>
                  {/* Non cliquable pour cette task (sous-total de section, cf. Task 4). */}
                  <AmountCells
                    cells={sec.totals}
                    mode="total"
                    solde={solde.uncategorizedRunning ?? undefined}
                    months={months}
                  />
                </TableRow>
                {uOpen && sec.txns?.map((t) => (
                  <TxnRow key={t.id} txn={t} months={months} groups={groups} indent={1} />
                ))}
              </Fragment>
            );
          }
          return (
            <Fragment key={sec.kind}>
              <TableRow className="bg-muted/40 hover:bg-muted/40 font-medium">
                <TableCell className={cn("sticky left-0 z-10 p-0", MUTED40)}>
                  <FirstColBox>{sec.kind === "envelope" ? "Enveloppes" : "Récurrents"}</FirstColBox>
                </TableCell>
                {/* Non cliquable pour cette task (sous-total de section, cf. Task 4). */}
                <AmountCells cells={sec.totals} mode="total" months={months} />
              </TableRow>
              {sec.rows.map((r) => renderGroup(r))}
            </Fragment>
          );
        })}
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Solde actuel</FirstColBox>
          </TableCell>
          {/* Non cliquable pour cette task (ligne de synthèse, cf. Task 4). */}
          {grand.map((c, i) => (
            <Fragment key={i}>
              <TableCell className="border-l text-right tabular-nums text-muted-foreground">{fmt(c.budgeted)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(c.depense)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmt(c.recu)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", c.balance < 0 && "text-red-600")}>{fmt(c.balance)}</TableCell>
              <TableCell className={cn("text-right tabular-nums", solde.closings[i] < -0.005 && "text-red-600")}>
                {fmt(solde.closings[i])}
              </TableCell>
            </Fragment>
          ))}
        </TableRow>
        {/* Estimé fin de mois : mois courant = solde projeté fin de mois
            (`forecast.currentEstimate`, distinct du solde « maintenant » sur la
            ligne « Solde actuel ») ; autres mois = leur solde de clôture.
            Non cliquable pour cette task (ligne de synthèse, cf. Task 4). */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Estimé fin de mois</span></FirstColBox>
          </TableCell>
          {months.map((m, i) => {
            const v = m === currentMonth ? forecast.currentEstimate : solde.closings[i];
            return (
              <Fragment key={i}>
                <TableCell className="border-l" />
                <TableCell />
                <TableCell />
                <TableCell />
                <TableCell className={cn("text-right tabular-nums", v < -0.005 && "text-red-600")}>{fmt(v)}</TableCell>
              </Fragment>
            );
          })}
        </TableRow>
        {/* Dépassement : total des dépassements de budget (somme des Reste rouges).
            Non cliquable pour cette task (ligne de synthèse, cf. Task 4). */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Dépassement</span></FirstColBox>
          </TableCell>
          {months.map((_, i) => (
            <Fragment key={i}>
              <TableCell className="border-l" />
              <TableCell />
              <TableCell />
              <TableCell className={cn("text-right tabular-nums", overspend[i] > 0 && "text-red-600")}>
                {overspend[i] > 0 ? fmt(overspend[i]) : "—"}
              </TableCell>
              <TableCell />
            </Fragment>
          ))}
        </TableRow>
      </TableBody>
    </Table>
    <HistoryDetailSidebar detail={selected} onClose={() => setSelected(null)} />
    </>
  );
}
