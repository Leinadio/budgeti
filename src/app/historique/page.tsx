import { db } from "../../db/index";
import { listAccounts } from "../../db/repositories/accounts";
import { listTransactions, sumIgnoredByAccount, type TxnView } from "../../db/repositories/transactions";
import { listGroups } from "../../db/repositories/groups";
import { listBudgetAmounts } from "../../db/repositories/budget-amounts";
import { listOverspendDecisions } from "../../db/repositories/overspend-decisions";
import {
  computeHistory, grandTotals, monthlyOverspend, monthsWithData, computeSolde,
  computePlannedSoldes, addMonthsKey, monthRange, isMonthKey, clampMonth,
  sliceHistorySections, sliceSoldeColumn, slicePlannedSoldes, computeTableEstimate,
  toDatedBudgets, computeOverspends, budgetInForce, provisionInForce, computeIgnoredBlocks,
} from "../../lib/history";
import { computeForecast, type Group, type Txn } from "../../lib/forecast";
import { ForecastDetailSheet } from "@/components/forecast-detail-sheet";
import { monthKey } from "../../lib/money";
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
  const currentMonth = monthKey(new Date().toISOString().slice(0, 10));
  const accounts = listAccounts(database);
  const allGroups = listGroups(database);
  const datedBudgets = toDatedBudgets(listBudgetAmounts(database));
  const toTxn = (t: TxnView): Txn => ({
    id: t.id,
    date: t.date,
    amount: t.amount,
    label: t.label,
    accountId: t.accountId,
    groupId: t.groupId,
    lineId: t.lineId,
    excluded: t.excluded,
    incomeKind: t.incomeKind,
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
          // Si la fenêtre commence après le mois courant, on calcule quand même
          // depuis le mois courant (l'ancre des chaînes de solde), puis on ne garde
          // que les mois affichés : les montants ne dépendent pas de la fenêtre.
          const calcFrom = from <= currentMonth ? from : currentMonth;
          const calcMonths = monthRange(calcFrom, to);
          const k = calcMonths.length - months.length;
          // Le solde de la banque privé de ce qui est hors calcul : c'est LUI qui
          // ancre tout ce qui suit (prévision, estimé de fin de mois, chaîne de soldes).
          const balance = effectiveBalance(a.balance, ignoredByAccount[a.id]);
          const forecast = computeForecast(a.id, balance, groups, txns, currentMonth);
          const sectionsFull = computeHistory(groups, txns, calcMonths, currentMonth, datedBudgets);
          // Estimé de fin du mois courant aligné sur le tableau (Balances vertes +
          // rémunérations restant à recevoir) : c'est lui qui ancre les chaînes des
          // mois futurs.
          const estimateValue =
            computeTableEstimate(sectionsFull, calcMonths, currentMonth, balance)?.value ?? forecast.currentEstimate;
          const soldeFull = computeSolde(sectionsFull, calcMonths, currentMonth, balance, estimateValue);
          const decisions = listOverspendDecisions(database, a.id);
          const overspends = computeOverspends(groups, txns, currentMonth, decisions, datedBudgets);
          const currentBudgets = Object.fromEntries(groups.map((g) => [g.id, budgetInForce(g, currentMonth, datedBudgets)]));
          // Provision non catégorisés en vigueur au mois courant, pour pré-remplir le
          // champ « Nouvelle provision » du bloc de décision d'un dépassement (groupe 0).
          const currentUncatProvision = provisionInForce(datedBudgets, currentMonth);
          const plannedFull = computePlannedSoldes(sectionsFull, calcMonths, currentMonth, soldeFull.openings, estimateValue, datedBudgets);
          const sections = sliceHistorySections(sectionsFull, calcMonths, k);
          const solde = sliceSoldeColumn(soldeFull, k);
          const planned = slicePlannedSoldes(plannedFull, k);
          const overspend = monthlyOverspend(sections, months.length);
          const grand = grandTotals(sections, months.length);
          // Calculé sur les mois affichés, à l'écart des sections : aucun total ne le voit.
          const ignoredBlocks = computeIgnoredBlocks(allIgnored.filter((t) => t.accountId === a.id), months);
          const selectGroups = groups.map((g) => ({
            id: g.id,
            name: g.name,
            kind: g.kind,
            lines: g.lines.map((l) => ({ id: l.id, name: l.name, amount: l.amount, day: l.day })),
          }));

          return (
            <TabsContent key={a.id} value={a.id} className="flex flex-col gap-4">
              <MonthRangePicker min={stripMin} max={stripMax} from={from} to={to} current={currentMonth} />
              <div className="flex justify-end">
                <ForecastDetailSheet label={accountLabel(a)} forecast={forecast} />
              </div>
              {sections.length === 0 ? (
                <p className="text-muted-foreground text-sm">Aucune donnée pour ce compte.</p>
              ) : (
                <HistoryWithDetail
                  months={months}
                  currentMonth={currentMonth}
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
                  decisions={decisions.map(({ groupId, month, decision }) => ({ groupId, month, decision }))}
                  pending={overspends.pending}
                  pendingByMonth={overspends.pendingByMonth}
                  currentBudgets={currentBudgets}
                  currentUncatProvision={currentUncatProvision}
                />
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
