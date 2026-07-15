"use client";
import { Fragment, useMemo, useState } from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { resolveOwnership, type OwnableGroup } from "@/lib/ownership";
import type { TxnView } from "@/db/repositories/transactions";
import { formatEur } from "@/lib/money";
import { groupByMonth } from "@/lib/transactions-view";
import {
  filterTransactions,
  summarize,
  hasActiveFilters,
  EMPTY_FILTERS,
  type TxnFilters,
} from "@/lib/transactions-filter";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { GroupSelectField } from "@/components/group-select-field";
import { TruncatedText } from "@/components/truncated-text";
import { AddTransactionSheet } from "@/components/add-transaction-sheet";
import { Badge } from "@/components/ui/badge";
import { ManualTxnActions } from "@/components/manual-txn-actions";

type ClientGroup = OwnableGroup & { name: string; lines: { id: number; name: string }[] };

export function TransactionsBrowser({ transactions, groups, accounts }: { transactions: TxnView[]; groups: ClientGroup[]; accounts: { id: string; label: string }[] }) {
  const [filters, setFilters] = useState<TxnFilters>(EMPTY_FILTERS);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleMonth = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const ownable: OwnableGroup[] = groups;
  const formGroups = groups.map((g) => ({ id: g.id, name: g.name, accountId: g.accountId, direction: g.direction }));

  const renderLabel = (t: TxnView) => (
    <span className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5">
        <TruncatedText text={t.label} className="max-w-[380px]" />
        {t.manual && <Badge variant="outline">manuel · en attente</Badge>}
      </span>
      {t.note && <span className="text-muted-foreground text-xs">{t.note}</span>}
    </span>
  );

  const groupName = (id: number) => groups.find((g) => g.id === id)?.name ?? "?";
  const groupsOfAccount = (accountId: string) =>
    groups
      .filter((g) => g.accountId === accountId)
      .map((g) => ({ id: g.id, name: g.name, lines: g.lines }));
  const lineName = (id: number) => {
    for (const g of groups) {
      const l = g.lines.find((x) => x.id === id);
      if (l) return l.name;
    }
    return null;
  };

  const statusLabel = (t: TxnView): string => {
    const res = resolveOwnership(
      { id: t.id, date: t.date, amount: t.amount, label: t.label, accountId: t.accountId, groupId: t.groupId, excluded: t.excluded },
      ownable,
    );
    if (res.status === "manual") {
      const base = groupName(res.groupId);
      const ln = t.lineId !== null ? lineName(t.lineId) : null;
      return ln ? `${base} › ${ln}` : base;
    }
    return "non catégorisée";
  };

  const accountTxnGroups = useMemo(() => {
    const byAccount = new Map<string, { label: string; items: TxnView[] }>();
    for (const t of transactions) {
      const g = byAccount.get(t.accountId) ?? { label: t.accountLabel ?? "Compte", items: [] };
      g.items.push(t);
      byAccount.set(t.accountId, g);
    }
    return [...byAccount.entries()];
  }, [transactions]);

  const results = useMemo(() => {
    const filtered = filterTransactions(transactions, filters, ownable);
    return [...filtered].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactions, filters]);
  const summary = useMemo(() => summarize(results), [results]);

  const set = (patch: Partial<TxnFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
  const active = hasActiveFilters(filters);

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <AddTransactionSheet accounts={accounts} groups={formGroups} />
        </div>
        <p className="text-muted-foreground text-sm">
          Aucune transaction synchronisée. Ajoute-en une à la main ou synchronise dans Réglages.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <AddTransactionSheet accounts={accounts} groups={formGroups} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Rechercher un libellé…"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
          className="w-56"
        />
        <select
          value={filters.group === "all" ? "all" : filters.group === "none" ? "none" : String(filters.group)}
          onChange={(e) => {
            const v = e.target.value;
            set({ group: v === "all" || v === "none" ? v : Number(v) });
          }}
          className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        >
          <option value="all">Tous les groupes</option>
          <option value="none">Non catégorisées</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Min €"
          value={filters.amountMin ?? ""}
          onChange={(e) => set({ amountMin: numOrNull(e.target.value) })}
          className="w-24"
        />
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Max €"
          value={filters.amountMax ?? ""}
          onChange={(e) => set({ amountMax: numOrNull(e.target.value) })}
          className="w-24"
        />
        <Input
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={(e) => set({ dateFrom: e.target.value || null })}
          className="w-40"
        />
        <Input
          type="date"
          value={filters.dateTo ?? ""}
          onChange={(e) => set({ dateTo: e.target.value || null })}
          className="w-40"
        />
        {active && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            <X className="size-4" />
            Réinitialiser
          </Button>
        )}
      </div>

      {active ? (
        <div className="flex flex-col gap-2">
          <div className="text-muted-foreground text-sm">
            {summary.count} transaction{summary.count > 1 ? "s" : ""} · Sorties{" "}
            <span className="tabular-nums">{formatEur(-summary.out)}</span> · Entrées{" "}
            <span className="tabular-nums">{formatEur(summary.in)}</span> · Net{" "}
            <span className={summary.net < 0 ? "text-red-600 tabular-nums" : "tabular-nums"}>{formatEur(summary.net)}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Compte</TableHead>
                <TableHead>Libellé</TableHead>
                <TableHead>Groupe</TableHead>
                <TableHead>Appartenance</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">Aucun résultat.</TableCell>
                </TableRow>
              ) : (
                results.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{t.date}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{t.accountLabel}</TableCell>
                    <TableCell>{renderLabel(t)}</TableCell>
                    <TableCell>
                      <GroupSelectField txnId={t.id} groups={groupsOfAccount(t.accountId)} defaultGroupId={t.groupId} defaultLineId={t.lineId} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <TruncatedText text={statusLabel(t)} className="max-w-[200px]" />
                    </TableCell>
                    <TableCell className="text-right font-medium whitespace-nowrap">{formatEur(t.amount)}</TableCell>
                    <TableCell className="text-right">
                      {t.manual && <ManualTxnActions txn={t} accounts={accounts} groups={formGroups} />}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <Tabs defaultValue={accountTxnGroups[0]?.[0]}>
          <TabsList>
            {accountTxnGroups.map(([accountId, group]) => (
              <TabsTrigger key={accountId} value={accountId}>
                {group.label}
              </TabsTrigger>
            ))}
          </TabsList>
          {accountTxnGroups.map(([accountId, group]) => (
            <TabsContent key={accountId} value={accountId}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Libellé</TableHead>
                    <TableHead>Groupe</TableHead>
                    <TableHead>Appartenance</TableHead>
                    <TableHead className="text-right">Montant</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupByMonth(group.items).map((m) => {
                    const key = `${accountId}:${m.month}`;
                    const isCollapsed = collapsed.has(key);
                    return (
                    <Fragment key={m.month}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleMonth(key)}>
                        <TableCell colSpan={6} className="text-muted-foreground text-sm font-medium">
                          <span className="flex items-center gap-1.5">
                            {isCollapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                            {m.label}
                            <span className="text-xs font-normal">({m.items.length})</span>
                          </span>
                        </TableCell>
                      </TableRow>
                      {!isCollapsed && m.items.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell className="text-muted-foreground">{t.date}</TableCell>
                          <TableCell>{renderLabel(t)}</TableCell>
                          <TableCell>
                            <GroupSelectField txnId={t.id} groups={groupsOfAccount(t.accountId)} defaultGroupId={t.groupId} defaultLineId={t.lineId} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            <TruncatedText text={statusLabel(t)} className="max-w-[200px]" />
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                          <TableCell className="text-right">
                            {t.manual && <ManualTxnActions txn={t} accounts={accounts} groups={formGroups} />}
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
