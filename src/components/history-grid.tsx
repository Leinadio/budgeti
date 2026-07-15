"use client";
import { Fragment, useState } from "react";
import { ArrowUpRight, ArrowDownRight, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEur } from "@/lib/money";
import { monthLabel } from "@/lib/transactions-view";
import type { AccountForecast } from "@/lib/forecast";
import { monthsDiff, type MonthCell, type HistorySection, type HistoryRow, type HistorySubRow, type HistoryTxn, type SoldeColumn } from "@/lib/history";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TruncatedText } from "@/components/truncated-text";
import { GroupSelectField } from "@/components/group-select-field";

// Groupes du compte, pour le menu de (ré)assignation sur chaque transaction.
type SelectGroup = { id: number; name: string; lines: { id: number; name: string }[] };
const MUTED40 = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";

const NUM = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (n: number) => NUM.format(n).replace(/[  ]/g, " ");

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

// mode : "out" (dépense), "in" (entrée) ou "total" (sous-total, montre les deux
// colonnes). La colonne Solde affiche le solde du compte cumulé, fourni par
// `solde` (une valeur par mois) ; absente ou null => cellule vide.
function AmountCells({ cells, mode, solde }: { cells: MonthCell[]; mode: "out" | "in" | "total"; solde?: (number | null)[] }) {
  return (
    <>
      {cells.map((c, i) => (
        <Fragment key={i}>
          <TableCell className="border-l text-right tabular-nums text-muted-foreground">
            {mode === "in" ? "" : fmt(c.budgeted)}
          </TableCell>
          <TableCell className="text-right tabular-nums">{mode === "in" ? "—" : fmt(c.depense)}</TableCell>
          <TableCell className="text-right tabular-nums">{mode === "out" ? "—" : fmt(c.recu)}</TableCell>
          <TableCell className={cn("text-right tabular-nums", mode !== "in" && c.balance < 0 && "text-red-600")}>
            {mode === "in" ? "" : fmt(c.balance)}
          </TableCell>
          <TableCell className={cn("text-right tabular-nums", solde?.[i] != null && solde[i]! < 0 && "text-red-600")}>
            {solde?.[i] != null ? fmt(solde[i]!) : ""}
          </TableCell>
        </Fragment>
      ))}
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

// Estimés du forecast rattachés à leur mois : le mois courant reçoit le solde et
// l'estimé fin de mois ; chaque mois futur reçoit une projection linéaire
// (le net mensuel du forecast répété), avec sa variante « dépassements maintenus ».
function ForecastCard({ month, currentMonth, f, overspend }: {
  month: string;
  currentMonth: string;
  f: AccountForecast;
  overspend: number;
}) {
  let estimates: [string, number][] = [];
  if (month === currentMonth) {
    estimates = [["Solde actuel", f.balance], ["Estimé fin de mois", f.currentEstimate]];
  } else if (month > currentMonth) {
    const k = monthsDiff(currentMonth, month); // nombre de mois après le mois courant (>=1)
    const monthlyNet = f.nextEstimate - f.currentEstimate; // net d'un mois de budgets
    const estime = f.currentEstimate + k * monthlyNet;
    const maintenu = estime - k * f.overspendTotal; // dépassements répétés chaque mois
    estimates = [["Estimé", estime], ["Dépassements maintenus", maintenu]];
  }
  return (
    <div className="flex flex-col gap-0.5 py-1 text-xs font-normal normal-case">
      {estimates.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <span className="text-muted-foreground">{label}</span>
          <span className={cn("font-semibold tabular-nums", value < 0 && "text-red-600")}>{formatEur(value)}</span>
        </div>
      ))}
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">Dépassement</span>
        <span className="font-semibold tabular-nums text-red-600">{overspend > 0 ? formatEur(overspend) : "—"}</span>
      </div>
    </div>
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

  const renderGroup = (r: HistoryRow) => {
    const gKey = `g:${r.id}`;
    const hasChildren = r.subRows.length > 0 || r.txns.length > 0;
    const gOpen = isOpen(gKey);
    return (
      <Fragment key={r.id}>
        <TableRow className={cn(hasChildren && "hover:bg-muted/50")}>
          <NameCell indent={0} expandable={hasChildren} expanded={gOpen} onToggle={hasChildren ? () => toggle(gKey) : undefined}>
            {r.direction === "in" ? (
              <ArrowUpRight className="size-4 shrink-0 text-sky-600" />
            ) : (
              <ArrowDownRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate font-medium">{r.name}</span>
          </NameCell>
          <AmountCells cells={r.cells} mode={r.direction} solde={solde.rowRunning[r.id]} />
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
                    <AmountCells cells={sub.cells} mode={r.direction} />
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
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead rowSpan={3} className="bg-background sticky left-0 z-10 p-0 align-bottom">
            <FirstColBox>Catégorie</FirstColBox>
          </TableHead>
          {months.map((m, i) => (
            <TableHead key={m} colSpan={5} className="border-l align-bottom font-normal">
              <ForecastCard month={m} currentMonth={currentMonth} f={forecast} overspend={overspend[i]} />
            </TableHead>
          ))}
        </TableRow>
        <TableRow>
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
              <TableCell className={cn("text-right tabular-nums", v < 0 && "text-red-600")}>{fmt(v)}</TableCell>
            </Fragment>
          ))}
        </TableRow>
        {sections.map((sec) => {
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
                  <AmountCells cells={sec.totals} mode="total" solde={solde.uncategorizedRunning ?? undefined} />
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
                <AmountCells cells={sec.totals} mode="total" />
              </TableRow>
              {sec.rows.map(renderGroup)}
            </Fragment>
          );
        })}
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Solde actuel</FirstColBox>
          </TableCell>
          <AmountCells cells={grand} mode="total" solde={solde.closings} />
        </TableRow>
      </TableBody>
    </Table>
  );
}
