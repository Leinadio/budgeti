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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { type CellExplanation, type ExplanationStep, resteExplanation, sumExplanation, runningExplanation, soldeActuelExplanation } from "@/lib/history-explain";

// Groupes du compte, pour le menu de (ré)assignation sur chaque transaction.
type SelectGroup = { id: number; name: string; lines: { id: number; name: string }[] };
const MUTED40 = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--background))]";

// Libellé affiché pour une section, dans le détail par section (ex. « Solde actuel »).
function labelOfSection(kind: HistorySection["kind"]): string {
  switch (kind) {
    case "income": return "Rémunérations";
    case "recurring": return "Récurrents";
    case "envelope": return "Enveloppes";
    case "uncategorized": return "Non catégorisés";
  }
}

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

// Contenu du popover : titre, étapes signées, total en gras.
function ExplanationContent({ e }: { e: CellExplanation }) {
  const money = (n: number) => (
    <span className={cn("tabular-nums whitespace-nowrap", n < 0 && "text-red-600")}>{fmt(n)}</span>
  );
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="font-medium">{e.title}</div>
      <div className="mt-1 flex flex-col gap-0.5">
        {e.steps.map((s, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <span className="text-muted-foreground">{s.label}</span>
            {money(s.amount)}
          </div>
        ))}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-4 border-t pt-1 font-semibold">
        <span>Total</span>
        {money(e.result)}
      </div>
      {e.note && <p className="text-muted-foreground mt-1 text-xs">{e.note}</p>}
    </div>
  );
}

// Cellule de montant : cliquable (popover) si une explication est fournie.
function CellAmount({ children, className, explanation }: {
  children: React.ReactNode;
  className?: string;
  explanation?: CellExplanation | null;
}) {
  if (!explanation) return <TableCell className={className}>{children}</TableCell>;
  return (
    <TableCell className={className}>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="cursor-pointer decoration-dotted underline-offset-2 hover:underline">
            {children}
          </button>
        </PopoverTrigger>
        <PopoverContent><ExplanationContent e={explanation} /></PopoverContent>
      </Popover>
    </TableCell>
  );
}

// mode : "out" (dépense), "in" (entrée) ou "total" (sous-total, montre les deux
// colonnes). La colonne Solde affiche le solde du compte cumulé, fourni par
// `solde` (une valeur par mois) ; absente ou null => cellule vide.
function AmountCells({ cells, mode, solde, depEntries, recuEntries, budgetEntries }: {
  cells: MonthCell[];
  mode: "out" | "in" | "total";
  solde?: (number | null)[];
  // Entrées de détail pour la colonne Dépensé, par mois (transactions ou groupes).
  depEntries?: (i: number) => ExplanationStep[] | null;
  // Entrées de détail pour la colonne Reçu, par mois.
  recuEntries?: (i: number) => ExplanationStep[] | null;
  // Entrées de détail pour Budget (postes d'un récurrent, ou groupes d'une section), par mois.
  budgetEntries?: (i: number) => ExplanationStep[] | null;
}) {
  return (
    <>
      {cells.map((c, i) => (
        <Fragment key={i}>
          <CellAmount
            className="border-l text-right tabular-nums text-muted-foreground"
            explanation={mode !== "in" && c.budgeted !== 0 && budgetEntries?.(i) ? sumExplanation("Budget — postes", budgetEntries(i)!) : null}
          >
            {mode === "in" ? "" : fmt(c.budgeted)}
          </CellAmount>
          <CellAmount
            className="text-right tabular-nums"
            explanation={mode !== "in" && c.depense !== 0 && depEntries?.(i) ? sumExplanation("Dépensé — détail", depEntries(i)!) : null}
          >
            {mode === "in" ? "—" : fmt(c.depense)}
          </CellAmount>
          <CellAmount
            className="text-right tabular-nums"
            explanation={mode !== "out" && c.recu !== 0 && recuEntries?.(i) ? sumExplanation("Reçu — détail", recuEntries(i)!) : null}
          >
            {mode === "out" ? "—" : fmt(c.recu)}
          </CellAmount>
          <CellAmount
            className={cn("text-right tabular-nums", mode !== "in" && c.balance < 0 && "text-red-600")}
            explanation={mode !== "in" && Math.abs(c.budgeted - c.depense - c.balance) < 0.005 ? resteExplanation(c.budgeted, c.depense) : null}
          >
            {mode === "in" ? "" : fmt(c.balance)}
          </CellAmount>
          {(() => {
            const s = solde?.[i];
            const net = c.recu - c.depense;
            // Solde précédent = solde de cette ligne − son propre mouvement.
            const exp = s != null ? runningExplanation(s - net, net) : null;
            return (
              <CellAmount className={cn("text-right tabular-nums", s != null && s < -0.005 && "text-red-600")} explanation={exp}>
                {s != null ? fmt(s) : ""}
              </CellAmount>
            );
          })()}
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

  // Transactions d'un groupe pour un mois donné → entrées {libellé, montant} pour le popover.
  // Montant en valeur absolue (le total du popover doit égaler la cellule Dép./Reçu).
  const txnEntries = (r: HistoryRow, month: string): ExplanationStep[] | null => {
    const all = [...r.txns, ...r.subRows.flatMap((s) => s.txns)].filter((t) => t.month === month);
    if (all.length === 0) return null;
    return all.map((t) => ({ label: `${t.date} · ${t.label}`, amount: Math.abs(t.amount) }));
  };

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
            depEntries={(i) => txnEntries(r, months[i])}
            recuEntries={(i) => txnEntries(r, months[i])}
            budgetEntries={(i) => r.subRows.length > 0 ? r.subRows.map((s) => ({ label: s.name, amount: s.cells[i].budgeted })).filter((e) => e.amount !== 0) : null}
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
              {(() => {
                const exp: CellExplanation = i === 0
                  ? {
                      title: "Argent de départ",
                      steps: [
                        { label: "Solde du compte (banque)", amount: forecast.balance },
                        { label: "Mouvements affichés du mois", amount: -(grand[i].recu - grand[i].depense) },
                      ],
                      result: v,
                      note: "On rembobine depuis le solde réel de la banque.",
                    }
                  : sumExplanation("Argent de départ", [
                      { label: "Solde de fin du mois précédent", amount: solde.closings[i - 1] },
                    ]);
                return (
                  <CellAmount className={cn("text-right tabular-nums", v < -0.005 && "text-red-600")} explanation={exp}>
                    {fmt(v)}
                  </CellAmount>
                );
              })()}
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
                  <AmountCells
                    cells={sec.totals}
                    mode="total"
                    solde={solde.uncategorizedRunning ?? undefined}
                    depEntries={(i) => {
                      const list = (sec.txns ?? []).filter((t) => t.month === months[i] && t.amount < 0);
                      return list.length === 0 ? null : list.map((t) => ({ label: `${t.date} · ${t.label}`, amount: Math.abs(t.amount) }));
                    }}
                    recuEntries={(i) => {
                      const list = (sec.txns ?? []).filter((t) => t.month === months[i] && t.amount > 0);
                      return list.length === 0 ? null : list.map((t) => ({ label: `${t.date} · ${t.label}`, amount: t.amount }));
                    }}
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
                <AmountCells
                  cells={sec.totals}
                  mode="total"
                  depEntries={(i) => sec.rows.map((r) => ({ label: r.name, amount: r.cells[i].depense })).filter((e) => e.amount !== 0)}
                  recuEntries={(i) => sec.rows.map((r) => ({ label: r.name, amount: r.cells[i].recu })).filter((e) => e.amount !== 0)}
                  budgetEntries={(i) => sec.rows.map((r) => ({ label: r.name, amount: r.cells[i].budgeted })).filter((e) => e.amount !== 0)}
                />
              </TableRow>
              {sec.rows.map((r) => renderGroup(r))}
            </Fragment>
          );
        })}
        <TableRow className="bg-muted/60 hover:bg-muted/60 font-semibold">
          <TableCell className="sticky left-0 z-10 bg-[color-mix(in_oklab,var(--muted)_60%,var(--background))] p-0">
            <FirstColBox>Solde actuel</FirstColBox>
          </TableCell>
          {grand.map((c, i) => {
            // Détail Dép./Reçu de « Solde actuel » : par section, pas par groupe.
            const depEntries = sections
              .map((sec) => ({ label: labelOfSection(sec.kind), amount: Math.abs(sec.totals[i].depense) }))
              .filter((e) => e.amount !== 0);
            const recuEntries = sections
              .map((sec) => ({ label: labelOfSection(sec.kind), amount: Math.abs(sec.totals[i].recu) }))
              .filter((e) => e.amount !== 0);
            return (
              <Fragment key={i}>
                <CellAmount className="border-l text-right tabular-nums text-muted-foreground" explanation={null}>
                  {fmt(c.budgeted)}
                </CellAmount>
                <CellAmount
                  className="text-right tabular-nums"
                  explanation={c.depense !== 0 ? sumExplanation("Dépensé — détail", depEntries) : null}
                >
                  {fmt(c.depense)}
                </CellAmount>
                <CellAmount
                  className="text-right tabular-nums"
                  explanation={c.recu !== 0 ? sumExplanation("Reçu — détail", recuEntries) : null}
                >
                  {fmt(c.recu)}
                </CellAmount>
                <CellAmount
                  className={cn("text-right tabular-nums", c.balance < 0 && "text-red-600")}
                  explanation={Math.abs(c.budgeted - c.depense - c.balance) < 0.005 ? resteExplanation(c.budgeted, c.depense) : null}
                >
                  {fmt(c.balance)}
                </CellAmount>
                <CellAmount
                  className={cn("text-right tabular-nums", solde.closings[i] < -0.005 && "text-red-600")}
                  explanation={soldeActuelExplanation(solde.openings[i], c.recu, c.depense)}
                >
                  {fmt(solde.closings[i])}
                </CellAmount>
              </Fragment>
            );
          })}
        </TableRow>
        {/* Estimé fin de mois : mois courant = solde projeté fin de mois
            (`forecast.currentEstimate`, distinct du solde « maintenant » sur la
            ligne « Solde actuel ») ; autres mois = leur solde de clôture. */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Estimé fin de mois</span></FirstColBox>
          </TableCell>
          {months.map((m, i) => (
            <Fragment key={i}>
              <TableCell className="border-l" />
              <TableCell />
              <TableCell />
              <TableCell />
              {(() => {
                const v = m === currentMonth ? forecast.currentEstimate : solde.closings[i];
                const estimeExp: CellExplanation = m === currentMonth
                  ? {
                      title: "Estimé fin de mois",
                      steps: [
                        { label: "Solde actuel", amount: forecast.balance },
                        ...forecast.currentSteps.map((s) => ({ label: s.label, amount: s.amount })),
                      ],
                      result: forecast.currentEstimate,
                    }
                  : soldeActuelExplanation(solde.openings[i], grand[i].recu, grand[i].depense);
                return (
                  <CellAmount className={cn("text-right tabular-nums", v < -0.005 && "text-red-600")} explanation={estimeExp}>
                    {fmt(v)}
                  </CellAmount>
                );
              })()}
            </Fragment>
          ))}
        </TableRow>
        {/* Dépassement : total des dépassements de budget (somme des Reste rouges). */}
        <TableRow className="text-sm">
          <TableCell className="bg-background sticky left-0 z-10 p-0">
            <FirstColBox><span className="text-muted-foreground">Dépassement</span></FirstColBox>
          </TableCell>
          {months.map((_, i) => {
            const overEntries = sections
              .flatMap((s) => s.rows)
              .filter((r) => r.direction === "out" && r.cells[i].balance < 0)
              .map((r) => ({ label: r.name, amount: -r.cells[i].balance }));
            return (
              <Fragment key={i}>
                <TableCell className="border-l" />
                <TableCell />
                <TableCell />
                <CellAmount
                  className={cn("text-right tabular-nums", overspend[i] > 0 && "text-red-600")}
                  explanation={overspend[i] > 0 ? sumExplanation("Dépassement — groupes au-dessus du budget", overEntries) : null}
                >
                  {overspend[i] > 0 ? fmt(overspend[i]) : "—"}
                </CellAmount>
                <TableCell />
              </Fragment>
            );
          })}
        </TableRow>
      </TableBody>
    </Table>
  );
}
