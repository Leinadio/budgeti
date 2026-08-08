import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions, sumIgnoredByAccount, type TxnView } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { listBudgetAmounts } from "../../db/repositories/budget-amounts";
import { listLineAmounts } from "../../db/repositories/line-amounts";
import {
  computeHistory, grandTotals, monthlyOverspend, monthsWithData, computeSolde,
  computePlannedSoldes, addMonthsKey, monthRange, isMonthKey, clampMonth,
  sliceHistorySections, sliceSoldeColumn, slicePlannedSoldes, computeTableEstimate,
  toDatedBudgets, toDatedLineAmounts, computeOverspends, computeIgnoredBlocks,
} from "../../lib/history";
import { calcWindow } from "../../lib/calc-window";
import { budgetChanges } from "../../lib/budget-history";
import { withoutDismissed } from "../../lib/notifications";
import { listDismissedNotifications } from "../../db/repositories/dismissed-notifications";
import { computeForecast, type Group, type Txn } from "../../lib/forecast";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";
import { currentMonthKey } from "../../lib/current-month";
import { accountLabel, effectiveBalance } from "../../lib/account";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HistoryWithDetail } from "@/components/history-with-detail";
import { MonthRangePicker } from "@/components/month-range-picker";

export const dynamic = "force-dynamic";

const MAX_MONTHS = 24; // garde-fou : nombre de colonnes affichées au maximum

export default async function HistoriquePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
  const database = db();
  const currentMonth = currentMonthKey(new Date());
  const accounts = listAccounts(database);
  const allGroups = listGroups(database);
  const datedBudgets = toDatedBudgets(listBudgetAmounts(database));
  const datedLines = toDatedLineAmounts(listLineAmounts(database));
  const dismissed = listDismissedNotifications(database);
  const toTxn = (t: TxnView): Txn => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
    groupId: t.groupId,
    lineId: t.lineId,
    excluded: t.excluded,
    comment: t.comment,
  });
  // Les transactions des calculs : listTransactions écarte les non comptabilisées.
  const allTxns: Txn[] = listTransactions(database).map(toTxn);
  // Les non comptabilisées, à part : elles ne servent qu'à la section d'affichage
  // en bas du tableau et n'entrent dans aucun calcul.
  const allIgnored: Txn[] = listTransactions(database, { includeIgnored: true })
    .filter((t) => t.ignored)
    .map(toTxn);
  // À retrancher du solde bancaire avant tout calcul : sans ça, la chaîne de soldes
  // rembobine des mouvements d'où ces opérations sont absentes, en partant d'un solde
  // qui les contient — et se retrouve décalée de leur montant.
  const ignoredByAccount = sumIgnoredByAccount(database);

  if (accounts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucun compte. Synchronise d&apos;abord dans Réglages.
      </p>
    );
  }

  // Bornes communes : la frise monte jusqu'à 12 mois dans le futur (projections).
  // La borne basse est propre à chaque compte (premier mois avec des transactions
  // de ce compte) : pas de mois vides sélectionnables.
  const prevMonth = addMonthsKey(currentMonth, -1);
  const stripMax = addMonthsKey(currentMonth, 12);

  // Plage demandée dans l'URL (clampée par compte plus bas), sinon 3 mois à partir
  // du mois courant (le mois courant en première colonne, puis deux mois de projection).
  const sp = await searchParams;
  const rawFrom = Array.isArray(sp.from) ? sp.from[0] : sp.from;
  const rawTo = Array.isArray(sp.to) ? sp.to[0] : sp.to;

  return (
    <div className="flex flex-col gap-4">
      <Tabs defaultValue={accounts[0].id}>
        <TabsList>
          {accounts.map((a) => (
            <TabsTrigger key={a.id} value={a.id}>
              {accountLabel(a)}
            </TabsTrigger>
          ))}
        </TabsList>
        {accounts.map((a) => {
          const groups = allGroups.filter((g) => g.accountId === a.id) as Group[];
          const txns = allTxns.filter((t) => t.accountId === a.id);
          // Frise du compte : du premier mois avec des transactions de CE compte (au
          // moins le mois précédent) jusqu'à stripMax. La plage de l'URL est clampée
          // sur ces bornes : un mois sans montants n'est ni sélectionnable ni affiché.
          const earliest = monthsWithData(txns)[0];
          const stripMin = earliest && earliest < prevMonth ? earliest : prevMonth;
          let from = isMonthKey(rawFrom) ? clampMonth(rawFrom, stripMin, stripMax) : currentMonth;
          let to = isMonthKey(rawTo) ? clampMonth(rawTo, stripMin, stripMax) : addMonthsKey(currentMonth, 2);
          if (from > to) [from, to] = [to, from];
          if (monthRange(from, to).length > MAX_MONTHS) to = addMonthsKey(from, MAX_MONTHS - 1);
          const months = monthRange(from, to);
          // La fenêtre de calcul contient TOUJOURS le mois courant, quitte à s'étendre
          // des deux côtés : c'est lui qui ancre les chaînes de solde, en se fermant sur
          // le solde de la banque. On coupe ensuite ce qui dépasse — les montants d'un
          // mois ne doivent pas dépendre des mois affichés à côté (cf. calcWindow).
          const w = calcWindow(from, to, currentMonth);
          const calcMonths = monthRange(w.calcFrom, w.calcTo);
          // Le solde de la banque privé de ce qui est hors calcul : c'est LUI qui
          // ancre tout ce qui suit (prévision, estimé de fin de mois, chaîne de soldes).
          const balance = effectiveBalance(a.balance, ignoredByAccount[a.id]);
          const forecast = computeForecast(a.id, balance, groups, txns, currentMonth, datedBudgets, datedLines);
          const sectionsFull = computeHistory(groups, txns, calcMonths, currentMonth, datedBudgets, datedLines);
          // Estimé de fin du mois courant aligné sur le tableau (Balances vertes +
          // rémunérations restant à recevoir) : c'est lui qui ancre les chaînes des
          // mois futurs.
          const estimateValue =
            computeTableEstimate(sectionsFull, calcMonths, currentMonth, balance)?.value ?? forecast.currentEstimate;
          const soldeFull = computeSolde(sectionsFull, calcMonths, currentMonth, balance, estimateValue);
          // Acquittés retirés à la source : l'étiquette sous les montants, le signal
          // porté par un groupe récurrent et le bandeau du side panel en découlent tous,
          // et suivent donc sans avoir à vérifier chacun de leur côté.
          const overspendsByMonth = withoutDismissed(
            computeOverspends(groups, txns, currentMonth, datedBudgets, datedLines).byMonth,
            a.id,
            dismissed,
          );
          const plannedFull = computePlannedSoldes(sectionsFull, calcMonths, currentMonth, soldeFull.openings, estimateValue, datedBudgets);
          const sections = sliceHistorySections(sectionsFull, calcMonths, w.dropStart, w.dropEnd);
          const solde = sliceSoldeColumn(soldeFull, w.dropStart, w.dropEnd);
          const planned = slicePlannedSoldes(plannedFull, w.dropStart, w.dropEnd);
          const overspend = monthlyOverspend(sections, months.length);
          const grand = grandTotals(sections, months.length);
          // Calculé sur les mois affichés, à l'écart des sections : aucun total ne le voit.
          const ignoredBlocks = computeIgnoredBlocks(allIgnored.filter((t) => t.accountId === a.id), months);
          const selectGroups = groups.map((g) => ({
            id: g.id,
            name: g.name,
            direction: g.direction,
            startMonth: g.startMonth,
            endMonth: g.endMonth,
            changes: budgetChanges(datedBudgets[g.id] ?? []),
            lines: g.lines.map((l) => ({
              id: l.id, name: l.name, amount: l.amount,
              startMonth: l.startMonth, endMonth: l.endMonth,
              changes: budgetChanges(datedLines[l.id] ?? []),
            })),
          }));

          return (
            <TabsContent key={a.id} value={a.id} className="flex flex-col gap-4">
              {/* Au-dessus de la frise, pas en dessous : la frise et le tableau
                  qu'elle commande restent collés, et le bouton d'explication du
                  calcul se lit comme un outil de la page, à l'écart de ce couple. */}
              <div className="flex justify-end">
                <ForecastDetailSheet label={accountLabel(a)} forecast={forecast} />
              </div>
              <MonthRangePicker min={stripMin} max={stripMax} from={from} to={to} current={currentMonth} />
              {sections.length === 0 ? (
                <p className="text-muted-foreground text-sm">Aucune donnée pour ce compte.</p>
              ) : (
                <HistoryWithDetail
                  months={months}
                  currentMonth={currentMonth}
                  stripMin={stripMin}
                  stripMax={stripMax}
                  forecast={forecast}
                  sections={sections}
                  ignoredBlocks={ignoredBlocks}
                  overspend={overspend}
                  grand={grand}
                  groups={selectGroups}
                  solde={solde}
                  planned={planned}
                  accountId={a.id}
                  overspendsByMonth={overspendsByMonth}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
