# Budget CIC — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-only personal budgeting web app that connects to the user's CIC bank account through the Enable Banking Open Banking aggregator, categorizes transactions automatically, tracks monthly budget envelopes, and surfaces in-app alerts.

**Architecture:** A Next.js (App Router) application running on `localhost`. Server-side route handlers talk to the Enable Banking API (JWT-signed requests using a locally-stored RSA private key). All data is persisted in a local SQLite file via `better-sqlite3`. The "brain" (categorization, budget math, alerts) is a set of pure functions in `src/lib/` with no I/O, fully unit-tested. The UI reads from SQLite through thin repository modules.

**Tech Stack:** Next.js 15 (App Router, TypeScript, React 19), `better-sqlite3` (SQLite), `vitest` (tests), `jose` (JWT signing for Enable Banking).

## Global Constraints

- **Local-only, single-user.** No hosting, no auth system, no multi-user. App runs on `http://localhost:3000` (Sandbox) and `https://localhost:3000` (Production, later).
- **Secrets never leave the machine and are never committed.** Enable Banking `APPLICATION_ID` and the private key path live in `.env.local`; the `.pem` key file lives in `secrets/` — both git-ignored.
- **Enable Banking base URL:** `https://api.enablebanking.com`. JWT auth: `alg: RS256`, header `kid` = `APPLICATION_ID`, body `{ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp }`, signed with the RSA private key. Reference: https://enablebanking.com/docs/api/reference/
- **Redirect URL:** `http://localhost:3000/api/callback` in Sandbox. Production later uses `https://localhost:3000/api/callback`.
- **Money convention:** amounts stored as JS `number` in euros, signed — debits negative, credits positive. Month keys are strings `"YYYY-MM"`. Dates are ISO `"YYYY-MM-DD"` strings.
- **DSP2 realities:** ~90-day re-consent; limited daily refresh. The app must degrade gracefully (show last known local data), never crash on aggregator errors.
- **TDD:** every logic task writes the failing test first. Commit after each green task.

---

## File Structure

```
budget-calcul/
  .env.local                      # APPLICATION_ID, key path (git-ignored)
  secrets/                        # RSA private key .pem (git-ignored)
  data/budget.db                  # SQLite file (git-ignored)
  src/
    db/
      schema.sql                  # table definitions
      index.ts                    # opens DB, runs schema, exports `db`
      repositories/
        accounts.ts
        transactions.ts
        categories.ts
        rules.ts
        budgets.ts
        settings.ts
    lib/
      categorize.ts               # pure: rules → category
      default-rules.ts            # seed keyword rules
      budget.ts                   # pure: spent/remaining per envelope
      alerts.ts                   # pure: build alert list
      money.ts                    # pure: parse/format amounts
    enablebanking/
      jwt.ts                      # sign request JWT
      client.ts                   # low-level GET/POST helpers
      connection.ts               # start auth, exchange callback → session
      sync.ts                     # fetch accounts/balances/transactions → DB
    app/
      layout.tsx
      page.tsx                    # Dashboard
      transactions/page.tsx
      budgets/page.tsx
      categories/page.tsx
      settings/page.tsx
      api/
        connect/route.ts          # POST → returns bank auth URL
        callback/route.ts         # GET → exchanges code, saves session
        sync/route.ts             # POST → runs sync
  tests/
    lib/
      categorize.test.ts
      budget.test.ts
      alerts.test.ts
      money.test.ts
    enablebanking/
      jwt.test.ts
      sync.test.ts
```

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.local.example`

**Interfaces:**
- Produces: a runnable Next.js + Vitest project. Scripts `dev`, `build`, `test`.

- [ ] **Step 1: Scaffold Next.js app**

Run in the project root:
```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-src-dir --eslint --use-npm --yes
```
Then move the app into `src/` layout by creating `src/app/` and deleting the generated `app/` after copying `layout.tsx`/`page.tsx`. (If create-next-app already made `app/` at root, just relocate to `src/app/`.)

- [ ] **Step 2: Add dependencies**

```bash
npm install better-sqlite3 jose
npm install -D vitest @types/better-sqlite3
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Add test + dev scripts to `package.json`**

Ensure `"scripts"` contains:
```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run"
}
```

- [ ] **Step 5: Write `.gitignore` additions**

Append:
```
.env.local
secrets/
data/
```

- [ ] **Step 6: Write `.env.local.example`**

```
# Enable Banking application ID (from the Control Panel)
ENABLEBANKING_APPLICATION_ID=
# Path to the downloaded RSA private key (.pem)
ENABLEBANKING_KEY_PATH=./secrets/private_key.pem
# Redirect URL registered in the Control Panel
ENABLEBANKING_REDIRECT_URL=http://localhost:3000/api/callback
```

- [ ] **Step 7: Verify the project runs**

Run: `npm run build`
Expected: build succeeds with the default page.

- [ ] **Step 8: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold Next.js + Vitest project"
```

---

## Task 2: SQLite schema and database module

**Files:**
- Create: `src/db/schema.sql`, `src/db/index.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Produces: `getDb(path?: string): Database` — opens SQLite, applies `schema.sql` (idempotent via `CREATE TABLE IF NOT EXISTS`), returns a `better-sqlite3` `Database`. A default shared instance `db` pointing at `data/budget.db`.

- [ ] **Step 1: Write `src/db/schema.sql`**

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,             -- Enable Banking account uid
  name TEXT NOT NULL,
  iban_masked TEXT,
  balance REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  last_synced TEXT                 -- ISO datetime
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,           -- matched case-insensitively against label
  category_id INTEGER NOT NULL REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,             -- Enable Banking entry_reference / transaction id
  account_id TEXT NOT NULL REFERENCES accounts(id),
  date TEXT NOT NULL,              -- YYYY-MM-DD
  amount REAL NOT NULL,            -- signed euros: debit negative, credit positive
  label TEXT NOT NULL,             -- raw bank label
  category_id INTEGER REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  month TEXT NOT NULL,             -- YYYY-MM
  limit_amount REAL NOT NULL,
  UNIQUE(category_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

- [ ] **Step 2: Write the failing test `tests/db/schema.test.ts`**

```ts
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";

test("schema creates all tables in an in-memory db", () => {
  const db = getDb(":memory:");
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r: any) => r.name);
  for (const t of ["accounts", "categories", "rules", "transactions", "budgets", "settings"]) {
    expect(tables).toContain(t);
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/db/schema.test.ts`
Expected: FAIL — cannot find `src/db/index`.

- [ ] **Step 4: Write `src/db/index.ts`**

```ts
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(join(process.cwd(), "src/db/schema.sql"), "utf8");

export function getDb(path = join(process.cwd(), "data/budget.db")): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

let _db: Database.Database | null = null;
export function db(): Database.Database {
  if (!_db) _db = getDb();
  return _db;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: sqlite schema and db module"
```

---

## Task 3: Money helpers

**Files:**
- Create: `src/lib/money.ts`
- Test: `tests/lib/money.test.ts`

**Interfaces:**
- Produces:
  - `parseAmount(raw: string, creditDebit: "CRDT" | "DBIT"): number` — turns Enable Banking's `{ amount: "12.34" }` + indicator into a signed euro number (DBIT → negative).
  - `formatEur(n: number): string` — e.g. `-12.3` → `"-12,30 €"`.
  - `monthKey(isoDate: string): string` — `"2026-07-04"` → `"2026-07"`.

- [ ] **Step 1: Write the failing test `tests/lib/money.test.ts`**

```ts
import { expect, test } from "vitest";
import { parseAmount, formatEur, monthKey } from "../../src/lib/money";

test("parseAmount signs debits negative", () => {
  expect(parseAmount("12.34", "DBIT")).toBe(-12.34);
  expect(parseAmount("50.00", "CRDT")).toBe(50);
});

test("formatEur formats French euros", () => {
  expect(formatEur(-12.3)).toBe("-12,30 €");
  expect(formatEur(1000)).toBe("1 000,00 €");
});

test("monthKey extracts YYYY-MM", () => {
  expect(monthKey("2026-07-04")).toBe("2026-07");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/money.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/money.ts`**

```ts
export function parseAmount(raw: string, creditDebit: "CRDT" | "DBIT"): number {
  const n = Number.parseFloat(raw);
  return creditDebit === "DBIT" ? -Math.abs(n) : Math.abs(n);
}

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});

export function formatEur(n: number): string {
  // Intl uses a narrow no-break space; normalize to a regular space for stable tests.
  return EUR.format(n).replace(/ | /g, " ");
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/money.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: money/date helpers"
```

---

## Task 4: Categorization engine + default rules

**Files:**
- Create: `src/lib/categorize.ts`, `src/lib/default-rules.ts`
- Test: `tests/lib/categorize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Rule = { keyword: string; category: string }`
  - `categorize(label: string, rules: Rule[]): string | null` — returns the category of the first rule whose keyword is a case-insensitive substring of `label`, else `null` (meaning "À catégoriser").
  - `DEFAULT_RULES: Rule[]` — seed rules covering common French merchants.

- [ ] **Step 1: Write the failing test `tests/lib/categorize.test.ts`**

```ts
import { expect, test } from "vitest";
import { categorize, type Rule } from "../../src/lib/categorize";
import { DEFAULT_RULES } from "../../src/lib/default-rules";

const rules: Rule[] = [
  { keyword: "CARREFOUR", category: "Courses" },
  { keyword: "SNCF", category: "Transport" },
];

test("matches keyword case-insensitively", () => {
  expect(categorize("CB carrefour market 03/07", rules)).toBe("Courses");
  expect(categorize("PRLV SNCF CONNECT", rules)).toBe("Transport");
});

test("returns null when nothing matches", () => {
  expect(categorize("VIR M. DUPONT", rules)).toBeNull();
});

test("default rules cover common merchants", () => {
  expect(categorize("LECLERC DRIVE", DEFAULT_RULES)).toBe("Courses");
  expect(categorize("UBER EATS", DEFAULT_RULES)).toBe("Restaurants");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/categorize.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/lib/categorize.ts`**

```ts
export type Rule = { keyword: string; category: string };

export function categorize(label: string, rules: Rule[]): string | null {
  const haystack = label.toUpperCase();
  for (const rule of rules) {
    if (haystack.includes(rule.keyword.toUpperCase())) return rule.category;
  }
  return null;
}
```

- [ ] **Step 4: Write `src/lib/default-rules.ts`**

```ts
import type { Rule } from "./categorize";

export const DEFAULT_RULES: Rule[] = [
  { keyword: "CARREFOUR", category: "Courses" },
  { keyword: "LECLERC", category: "Courses" },
  { keyword: "INTERMARCHE", category: "Courses" },
  { keyword: "LIDL", category: "Courses" },
  { keyword: "AUCHAN", category: "Courses" },
  { keyword: "MONOPRIX", category: "Courses" },
  { keyword: "UBER EATS", category: "Restaurants" },
  { keyword: "DELIVEROO", category: "Restaurants" },
  { keyword: "MCDONALD", category: "Restaurants" },
  { keyword: "SNCF", category: "Transport" },
  { keyword: "UBER", category: "Transport" },
  { keyword: "RATP", category: "Transport" },
  { keyword: "TOTAL", category: "Transport" },
  { keyword: "NETFLIX", category: "Abonnements" },
  { keyword: "SPOTIFY", category: "Abonnements" },
  { keyword: "FREE", category: "Abonnements" },
  { keyword: "ORANGE", category: "Abonnements" },
  { keyword: "EDF", category: "Logement" },
  { keyword: "LOYER", category: "Logement" },
  { keyword: "AMAZON", category: "Loisirs" },
  { keyword: "FNAC", category: "Loisirs" },
];

export const DEFAULT_CATEGORIES = [
  "Courses",
  "Restaurants",
  "Transport",
  "Abonnements",
  "Logement",
  "Loisirs",
];
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/lib/categorize.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: categorization engine + default rules"
```

---

## Task 5: Budget math

**Files:**
- Create: `src/lib/budget.ts`
- Test: `tests/lib/budget.test.ts`

**Interfaces:**
- Consumes: `monthKey` from `src/lib/money.ts`.
- Produces:
  - `type Txn = { date: string; amount: number; category: string | null }`
  - `type Budget = { category: string; month: string; limit: number }`
  - `type Envelope = { category: string; limit: number; spent: number; remaining: number; ratio: number }`
  - `computeEnvelopes(txns: Txn[], budgets: Budget[], month: string): Envelope[]` — for the given month, `spent` = sum of the **absolute value of debits** (negative amounts) in that category; `remaining = limit - spent`; `ratio = spent / limit` (0 if limit is 0).

- [ ] **Step 1: Write the failing test `tests/lib/budget.test.ts`**

```ts
import { expect, test } from "vitest";
import { computeEnvelopes, type Txn, type Budget } from "../../src/lib/budget";

const txns: Txn[] = [
  { date: "2026-07-01", amount: -30, category: "Courses" },
  { date: "2026-07-15", amount: -50, category: "Courses" },
  { date: "2026-07-10", amount: -20, category: "Transport" },
  { date: "2026-06-30", amount: -999, category: "Courses" }, // other month, ignored
  { date: "2026-07-20", amount: 100, category: "Courses" },  // credit, ignored in spend
];

const budgets: Budget[] = [
  { category: "Courses", month: "2026-07", limit: 400 },
  { category: "Transport", month: "2026-07", limit: 100 },
];

test("computes spent/remaining/ratio for the month", () => {
  const env = computeEnvelopes(txns, budgets, "2026-07");
  const courses = env.find((e) => e.category === "Courses")!;
  expect(courses.spent).toBe(80);
  expect(courses.remaining).toBe(320);
  expect(courses.ratio).toBeCloseTo(0.2);
});

test("ratio is 0 when limit is 0", () => {
  const env = computeEnvelopes(txns, [{ category: "X", month: "2026-07", limit: 0 }], "2026-07");
  expect(env[0].ratio).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/budget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/budget.ts`**

```ts
import { monthKey } from "./money";

export type Txn = { date: string; amount: number; category: string | null };
export type Budget = { category: string; month: string; limit: number };
export type Envelope = {
  category: string;
  limit: number;
  spent: number;
  remaining: number;
  ratio: number;
};

export function computeEnvelopes(txns: Txn[], budgets: Budget[], month: string): Envelope[] {
  return budgets
    .filter((b) => b.month === month)
    .map((b) => {
      const spent = txns
        .filter((t) => monthKey(t.date) === month && t.category === b.category && t.amount < 0)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const remaining = b.limit - spent;
      const ratio = b.limit > 0 ? spent / b.limit : 0;
      return { category: b.category, limit: b.limit, spent, remaining, ratio };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/budget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: budget envelope math"
```

---

## Task 6: Alerts engine

**Files:**
- Create: `src/lib/alerts.ts`
- Test: `tests/lib/alerts.test.ts`

**Interfaces:**
- Consumes: `Envelope` from `src/lib/budget.ts`.
- Produces:
  - `type Alert = { level: "warn" | "danger"; message: string }`
  - `buildAlerts(envelopes: Envelope[], balance: number, balanceThreshold: number): Alert[]` — one `warn` per envelope with `ratio >= 0.8 && ratio < 1`; one `danger` per envelope with `ratio >= 1`; one `danger` if `balance < balanceThreshold`.

- [ ] **Step 1: Write the failing test `tests/lib/alerts.test.ts`**

```ts
import { expect, test } from "vitest";
import { buildAlerts } from "../../src/lib/alerts";
import type { Envelope } from "../../src/lib/budget";

const env = (category: string, ratio: number): Envelope => ({
  category,
  limit: 100,
  spent: ratio * 100,
  remaining: 100 - ratio * 100,
  ratio,
});

test("warns at 80%, danger at overspend, danger under balance threshold", () => {
  const alerts = buildAlerts([env("Courses", 0.85), env("Transport", 1.2)], 150, 200);
  expect(alerts).toContainEqual({ level: "warn", message: expect.stringContaining("Courses") });
  expect(alerts).toContainEqual({ level: "danger", message: expect.stringContaining("Transport") });
  expect(alerts.some((a) => a.level === "danger" && a.message.includes("solde"))).toBe(true);
});

test("no alerts when everything is fine", () => {
  expect(buildAlerts([env("Courses", 0.3)], 500, 200)).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/lib/alerts.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/alerts.ts`**

```ts
import type { Envelope } from "./budget";
import { formatEur } from "./money";

export type Alert = { level: "warn" | "danger"; message: string };

export function buildAlerts(
  envelopes: Envelope[],
  balance: number,
  balanceThreshold: number,
): Alert[] {
  const alerts: Alert[] = [];
  for (const e of envelopes) {
    if (e.ratio >= 1) {
      alerts.push({
        level: "danger",
        message: `Budget dépassé sur ${e.category} (${formatEur(e.spent)} / ${formatEur(e.limit)}).`,
      });
    } else if (e.ratio >= 0.8) {
      alerts.push({
        level: "warn",
        message: `Attention, il te reste ${formatEur(e.remaining)} sur ${e.category}.`,
      });
    }
  }
  if (balance < balanceThreshold) {
    alerts.push({
      level: "danger",
      message: `Ton solde (${formatEur(balance)}) est passé sous ton seuil de ${formatEur(balanceThreshold)}.`,
    });
  }
  return alerts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/lib/alerts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: alerts engine"
```

---

## Task 7: Repositories (data access)

**Files:**
- Create: `src/db/repositories/accounts.ts`, `transactions.ts`, `categories.ts`, `rules.ts`, `budgets.ts`, `settings.ts`
- Test: `tests/db/repositories.test.ts`

**Interfaces:**
- Consumes: `getDb` from `src/db/index.ts`; a `Database` instance is passed into every repo function so tests can use `:memory:`.
- Produces (key signatures later tasks rely on):
  - `settings`: `getSetting(db, key): string | null`, `setSetting(db, key, value): void`
  - `categories`: `ensureCategory(db, name): number` (returns id, idempotent), `listCategories(db): {id:number;name:string}[]`
  - `rules`: `listRules(db): {keyword:string;category:string}[]`, `addRule(db, keyword, category): void`
  - `accounts`: `upsertAccount(db, a): void`, `listAccounts(db): Account[]`, `totalBalance(db): number`
  - `transactions`: `upsertTransaction(db, t): void` (INSERT OR IGNORE on id), `listTransactions(db, filter?): Txn[]`, `setTransactionCategory(db, id, categoryId): void`, `uncategorized(db): Txn[]`
  - `budgets`: `listBudgets(db): Budget[]`, `setBudget(db, category, month, limit): void`

- [ ] **Step 1: Write the failing test `tests/db/repositories.test.ts`**

```ts
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { ensureCategory, listCategories } from "../../src/db/repositories/categories";
import { upsertTransaction, listTransactions } from "../../src/db/repositories/transactions";
import { upsertAccount, totalBalance } from "../../src/db/repositories/accounts";
import { setSetting, getSetting } from "../../src/db/repositories/settings";

test("category ensure is idempotent", () => {
  const db = getDb(":memory:");
  const a = ensureCategory(db, "Courses");
  const b = ensureCategory(db, "Courses");
  expect(a).toBe(b);
  expect(listCategories(db)).toHaveLength(1);
});

test("transaction upsert dedupes by id and lists back", () => {
  const db = getDb(":memory:");
  upsertAccount(db, { id: "acc1", name: "CIC", iban_masked: "***1234", balance: 500, currency: "EUR", last_synced: null });
  const t = { id: "tx1", account_id: "acc1", date: "2026-07-01", amount: -30, label: "CARREFOUR", category_id: null };
  upsertTransaction(db, t);
  upsertTransaction(db, t); // duplicate ignored
  expect(listTransactions(db)).toHaveLength(1);
  expect(totalBalance(db)).toBe(500);
});

test("settings round-trip", () => {
  const db = getDb(":memory:");
  setSetting(db, "balance_threshold", "200");
  expect(getSetting(db, "balance_threshold")).toBe("200");
  expect(getSetting(db, "missing")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db/repositories.test.ts`
Expected: FAIL — repo modules not found.

- [ ] **Step 3: Write `src/db/repositories/settings.ts`**

```ts
import type Database from "better-sqlite3";

export function getSetting(db: Database.Database, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
```

- [ ] **Step 4: Write `src/db/repositories/categories.ts`**

```ts
import type Database from "better-sqlite3";

export function ensureCategory(db: Database.Database, name: string): number {
  db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(name);
  const row = db.prepare("SELECT id FROM categories WHERE name = ?").get(name) as { id: number };
  return row.id;
}

export function listCategories(db: Database.Database): { id: number; name: string }[] {
  return db.prepare("SELECT id, name FROM categories ORDER BY name").all() as { id: number; name: string }[];
}
```

- [ ] **Step 5: Write `src/db/repositories/rules.ts`**

```ts
import type Database from "better-sqlite3";
import { ensureCategory } from "./categories";

export function listRules(db: Database.Database): { keyword: string; category: string }[] {
  return db
    .prepare(
      "SELECT r.keyword AS keyword, c.name AS category FROM rules r JOIN categories c ON c.id = r.category_id",
    )
    .all() as { keyword: string; category: string }[];
}

export function addRule(db: Database.Database, keyword: string, category: string): void {
  const categoryId = ensureCategory(db, category);
  db.prepare("INSERT INTO rules (keyword, category_id) VALUES (?, ?)").run(keyword, categoryId);
}
```

- [ ] **Step 6: Write `src/db/repositories/accounts.ts`**

```ts
import type Database from "better-sqlite3";

export type Account = {
  id: string;
  name: string;
  iban_masked: string | null;
  balance: number;
  currency: string;
  last_synced: string | null;
};

export function upsertAccount(db: Database.Database, a: Account): void {
  db.prepare(
    `INSERT INTO accounts (id, name, iban_masked, balance, currency, last_synced)
     VALUES (@id, @name, @iban_masked, @balance, @currency, @last_synced)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, iban_masked = excluded.iban_masked,
       balance = excluded.balance, currency = excluded.currency,
       last_synced = excluded.last_synced`,
  ).run(a);
}

export function listAccounts(db: Database.Database): Account[] {
  return db.prepare("SELECT * FROM accounts").all() as Account[];
}

export function totalBalance(db: Database.Database): number {
  const row = db.prepare("SELECT COALESCE(SUM(balance), 0) AS total FROM accounts").get() as { total: number };
  return row.total;
}
```

- [ ] **Step 7: Write `src/db/repositories/transactions.ts`**

```ts
import type Database from "better-sqlite3";

export type TxnRow = {
  id: string;
  account_id: string;
  date: string;
  amount: number;
  label: string;
  category_id: number | null;
};

export type TxnView = { date: string; amount: number; category: string | null; label: string; id: string };

export function upsertTransaction(db: Database.Database, t: TxnRow): void {
  db.prepare(
    `INSERT OR IGNORE INTO transactions (id, account_id, date, amount, label, category_id)
     VALUES (@id, @account_id, @date, @amount, @label, @category_id)`,
  ).run(t);
}

export function listTransactions(
  db: Database.Database,
  filter?: { month?: string; category?: string },
): TxnView[] {
  let sql =
    "SELECT t.id, t.date, t.amount, t.label, c.name AS category FROM transactions t LEFT JOIN categories c ON c.id = t.category_id";
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter?.month) {
    clauses.push("substr(t.date,1,7) = @month");
    params.month = filter.month;
  }
  if (filter?.category) {
    clauses.push("c.name = @category");
    params.category = filter.category;
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  sql += " ORDER BY t.date DESC";
  return db.prepare(sql).all(params) as TxnView[];
}

export function uncategorized(db: Database.Database): TxnRow[] {
  return db.prepare("SELECT * FROM transactions WHERE category_id IS NULL").all() as TxnRow[];
}

export function setTransactionCategory(db: Database.Database, id: string, categoryId: number): void {
  db.prepare("UPDATE transactions SET category_id = ? WHERE id = ?").run(categoryId, id);
}
```

- [ ] **Step 8: Write `src/db/repositories/budgets.ts`**

```ts
import type Database from "better-sqlite3";
import { ensureCategory } from "./categories";

export type BudgetRow = { category: string; month: string; limit: number };

export function listBudgets(db: Database.Database): BudgetRow[] {
  return db
    .prepare(
      "SELECT c.name AS category, b.month AS month, b.limit_amount AS limit FROM budgets b JOIN categories c ON c.id = b.category_id",
    )
    .all() as BudgetRow[];
}

export function setBudget(db: Database.Database, category: string, month: string, limit: number): void {
  const categoryId = ensureCategory(db, category);
  db.prepare(
    `INSERT INTO budgets (category_id, month, limit_amount) VALUES (?, ?, ?)
     ON CONFLICT(category_id, month) DO UPDATE SET limit_amount = excluded.limit_amount`,
  ).run(categoryId, month, limit);
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- tests/db/repositories.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: sqlite repositories"
```

---

## Task 8: Seed script (default categories + rules)

**Files:**
- Create: `src/db/seed.ts`
- Test: `tests/db/seed.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_RULES`, `DEFAULT_CATEGORIES`, repositories.
- Produces: `seed(db): void` — inserts default categories and rules if the `categories` table is empty. Idempotent.

- [ ] **Step 1: Write the failing test `tests/db/seed.test.ts`**

```ts
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { seed } from "../../src/db/seed";
import { listCategories } from "../../src/db/repositories/categories";
import { listRules } from "../../src/db/repositories/rules";

test("seed inserts defaults once", () => {
  const db = getDb(":memory:");
  seed(db);
  seed(db); // idempotent
  expect(listCategories(db).length).toBeGreaterThan(0);
  expect(listRules(db).length).toBeGreaterThan(0);
  const carrefour = listRules(db).find((r) => r.keyword === "CARREFOUR");
  expect(carrefour?.category).toBe("Courses");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/db/seed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/db/seed.ts`**

```ts
import type Database from "better-sqlite3";
import { DEFAULT_CATEGORIES, DEFAULT_RULES } from "../lib/default-rules";
import { ensureCategory, listCategories } from "./repositories/categories";
import { addRule } from "./repositories/rules";

export function seed(db: Database.Database): void {
  if (listCategories(db).length > 0) return;
  for (const name of DEFAULT_CATEGORIES) ensureCategory(db, name);
  for (const rule of DEFAULT_RULES) addRule(db, rule.keyword, rule.category);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/db/seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire seed into `src/db/index.ts` `db()`**

In `src/db/index.ts`, update the lazy `db()` to seed on first open:
```ts
import { seed } from "./seed";
// ...
export function db(): Database.Database {
  if (!_db) {
    _db = getDb();
    seed(_db);
  }
  return _db;
}
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: seed default categories and rules"
```

---

## Task 9: Enable Banking JWT signing

**Files:**
- Create: `src/enablebanking/jwt.ts`
- Test: `tests/enablebanking/jwt.test.ts`

**Interfaces:**
- Consumes: env `ENABLEBANKING_APPLICATION_ID`, `ENABLEBANKING_KEY_PATH`; `jose`.
- Produces: `signRequestJwt(now?: number): Promise<string>` — RS256 JWT with header `{ typ:"JWT", alg:"RS256", kid: APPLICATION_ID }` and body `{ iss:"enablebanking.com", aud:"api.enablebanking.com", iat, exp: iat+3600 }`.

- [ ] **Step 1: Write the failing test `tests/enablebanking/jwt.test.ts`**

Generate an ephemeral RSA key in the test so we don't depend on real secrets:
```ts
import { expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { decodeProtectedHeader, decodeJwt } from "jose";

test("signs a valid RS256 JWT with correct header and claims", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  mkdirSync(join(process.cwd(), "secrets"), { recursive: true });
  const keyPath = join(process.cwd(), "secrets", "test_key.pem");
  writeFileSync(keyPath, pem);
  process.env.ENABLEBANKING_APPLICATION_ID = "app-123";
  process.env.ENABLEBANKING_KEY_PATH = keyPath;

  const { signRequestJwt } = await import("../../src/enablebanking/jwt");
  const token = await signRequestJwt(1_000_000);

  expect(decodeProtectedHeader(token)).toMatchObject({ alg: "RS256", kid: "app-123" });
  expect(decodeJwt(token)).toMatchObject({
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: 1_000_000,
    exp: 1_003_600,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/enablebanking/jwt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/enablebanking/jwt.ts`**

```ts
import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";

export async function signRequestJwt(now = Math.floor(Date.now() / 1000)): Promise<string> {
  const appId = process.env.ENABLEBANKING_APPLICATION_ID;
  const keyPath = process.env.ENABLEBANKING_KEY_PATH;
  if (!appId || !keyPath) throw new Error("Enable Banking env vars missing");

  const pem = readFileSync(keyPath, "utf8");
  const key = await importPKCS8(pem, "RS256");

  return new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "RS256", kid: appId })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/enablebanking/jwt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Enable Banking JWT signing"
```

---

## Task 10: Enable Banking HTTP client

**Files:**
- Create: `src/enablebanking/client.ts`

**Interfaces:**
- Consumes: `signRequestJwt`.
- Produces:
  - `ebGet<T>(path: string): Promise<T>`
  - `ebPost<T>(path: string, body: unknown): Promise<T>`
  - Both attach `Authorization: Bearer <jwt>` and throw `EnableBankingError` (with status + body) on non-2xx.

> No unit test — this is thin I/O over `fetch`; it is exercised by the sync test (Task 11) with a mocked `fetch`.

- [ ] **Step 1: Write `src/enablebanking/client.ts`**

```ts
import { signRequestJwt } from "./jwt";

const BASE = "https://api.enablebanking.com";

export class EnableBankingError extends Error {
  constructor(public status: number, public body: string) {
    super(`Enable Banking HTTP ${status}: ${body}`);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const jwt = await signRequestJwt();
  return { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" };
}

export async function ebGet<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: await authHeaders() });
  if (!res.ok) throw new EnableBankingError(res.status, await res.text());
  return (await res.json()) as T;
}

export async function ebPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new EnableBankingError(res.status, await res.text());
  return (await res.json()) as T;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: Enable Banking HTTP client"
```

---

## Task 11: Connection flow + sync

**Files:**
- Create: `src/enablebanking/connection.ts`, `src/enablebanking/sync.ts`
- Test: `tests/enablebanking/sync.test.ts`

**Interfaces:**
- Consumes: `ebGet`, `ebPost`, repositories, `categorize`, `listRules`, `ensureCategory`, `parseAmount`.
- Produces:
  - `connection.ts`: `startAuth(): Promise<{ url: string; authId: string }>` — POST `/auth` with `{ access, aspsp:{name:"CIC", country:"FR"}, redirect_url, valid_until, state }` → returns the bank auth `url`. `finishAuth(code: string): Promise<string>` — POST `/sessions` with `{ code }` → returns `session_id`, persists it and account uids in `settings`.
  - `sync.ts`: `syncAll(db, deps): Promise<{ imported: number }>` — for each account uid in the session: GET `/accounts/{uid}/balances` and `/accounts/{uid}/transactions`, upsert account + transactions (signed amounts), then categorize every uncategorized transaction using DB rules. `deps` injects `ebGet` so the test can mock it.

- [ ] **Step 1: Write the failing test `tests/enablebanking/sync.test.ts`**

```ts
import { expect, test } from "vitest";
import { getDb } from "../../src/db/index";
import { seed } from "../../src/db/seed";
import { syncAll } from "../../src/enablebanking/sync";
import { listTransactions } from "../../src/db/repositories/transactions";
import { totalBalance } from "../../src/db/repositories/accounts";

const fakeEbGet = async (path: string): Promise<any> => {
  if (path.endsWith("/balances")) {
    return { balances: [{ balance_amount: { amount: "500.00", currency: "EUR" } }] };
  }
  if (path.endsWith("/transactions")) {
    return {
      transactions: [
        {
          entry_reference: "tx1",
          booking_date: "2026-07-01",
          transaction_amount: { amount: "30.00", currency: "EUR" },
          credit_debit_indicator: "DBIT",
          remittance_information: ["CARREFOUR MARKET"],
        },
      ],
    };
  }
  return {};
};

test("sync imports balance + categorized transactions", async () => {
  const db = getDb(":memory:");
  seed(db);
  const result = await syncAll(db, {
    ebGet: fakeEbGet,
    accountUids: ["acc1"],
    accountName: "CIC",
  });
  expect(result.imported).toBe(1);
  expect(totalBalance(db)).toBe(500);
  const txns = listTransactions(db);
  expect(txns[0].category).toBe("Courses");
  expect(txns[0].amount).toBe(-30);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/enablebanking/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/enablebanking/sync.ts`**

```ts
import type Database from "better-sqlite3";
import { parseAmount } from "../lib/money";
import { categorize } from "../lib/categorize";
import { listRules } from "../db/repositories/rules";
import { ensureCategory } from "../db/repositories/categories";
import { upsertAccount } from "../db/repositories/accounts";
import { upsertTransaction, uncategorized, setTransactionCategory } from "../db/repositories/transactions";

type EbGet = <T>(path: string) => Promise<T>;

type BalancesResponse = { balances: { balance_amount: { amount: string; currency: string } }[] };
type TxnResponse = {
  transactions: {
    entry_reference?: string;
    transaction_id?: string;
    booking_date: string;
    transaction_amount: { amount: string; currency: string };
    credit_debit_indicator: "CRDT" | "DBIT";
    remittance_information?: string[];
  }[];
};

export async function syncAll(
  db: Database.Database,
  deps: { ebGet: EbGet; accountUids: string[]; accountName: string },
): Promise<{ imported: number }> {
  let imported = 0;
  const nowIso = new Date().toISOString();

  for (const uid of deps.accountUids) {
    const balances = await deps.ebGet<BalancesResponse>(`/accounts/${uid}/balances`);
    const balance = Number.parseFloat(balances.balances[0]?.balance_amount.amount ?? "0");
    upsertAccount(db, {
      id: uid,
      name: deps.accountName,
      iban_masked: null,
      balance,
      currency: balances.balances[0]?.balance_amount.currency ?? "EUR",
      last_synced: nowIso,
    });

    const txns = await deps.ebGet<TxnResponse>(`/accounts/${uid}/transactions`);
    for (const t of txns.transactions) {
      const id = t.entry_reference ?? t.transaction_id;
      if (!id) continue;
      const label = (t.remittance_information ?? []).join(" ").trim() || "(sans libellé)";
      upsertTransaction(db, {
        id,
        account_id: uid,
        date: t.booking_date,
        amount: parseAmount(t.transaction_amount.amount, t.credit_debit_indicator),
        label,
        category_id: null,
      });
      imported++;
    }
  }

  // Categorize everything still uncategorized.
  const rules = listRules(db);
  for (const t of uncategorized(db)) {
    const category = categorize(t.label, rules);
    if (category) setTransactionCategory(db, t.id, ensureCategory(db, category));
  }

  return { imported };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/enablebanking/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/enablebanking/connection.ts`**

```ts
import { ebPost } from "./client";
import { db } from "../db/index";
import { setSetting } from "../db/repositories/settings";

const REDIRECT_URL = process.env.ENABLEBANKING_REDIRECT_URL ?? "http://localhost:3000/api/callback";

export async function startAuth(): Promise<{ url: string; authId: string }> {
  // valid_until: 90-day consent window (max allowed by DSP2).
  const validUntil = new Date(Date.now() + 89 * 24 * 3600 * 1000).toISOString();
  const res = await ebPost<{ url: string; authorization_id: string }>("/auth", {
    access: { valid_until: validUntil },
    aspsp: { name: "CIC", country: "FR" },
    state: "budget-cic",
    redirect_url: REDIRECT_URL,
    psu_type: "personal",
  });
  setSetting(db(), "consent_valid_until", validUntil);
  return { url: res.url, authId: res.authorization_id };
}

export async function finishAuth(code: string): Promise<string> {
  const res = await ebPost<{ session_id: string; accounts: { uid: string }[] }>("/sessions", { code });
  setSetting(db(), "session_id", res.session_id);
  setSetting(db(), "account_uids", JSON.stringify(res.accounts.map((a) => a.uid)));
  return res.session_id;
}
```

> **Note for the implementer:** the exact request/response field names for `/auth` and `/sessions` must be confirmed against the live Enable Banking reference (https://enablebanking.com/docs/api/reference/) during first real Sandbox run. The shape above matches the documented v1 API; adjust field names if the Sandbox rejects them. The sync logic (Task 11, tested) is independent of these names.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add -A && git commit -m "feat: Enable Banking connection flow + sync"
```

---

## Task 12: API route handlers

**Files:**
- Create: `src/app/api/connect/route.ts`, `src/app/api/callback/route.ts`, `src/app/api/sync/route.ts`

**Interfaces:**
- Consumes: `startAuth`, `finishAuth`, `syncAll`, `db`, settings, `ebGet`.
- Produces: HTTP endpoints the UI calls. `/api/connect` (POST) → `{ url }`; `/api/callback` (GET, bank redirect) → exchanges `code`, redirects to `/`; `/api/sync` (POST) → `{ imported }` or graceful error JSON.

- [ ] **Step 1: Write `src/app/api/connect/route.ts`**

```ts
import { NextResponse } from "next/server";
import { startAuth } from "../../../enablebanking/connection";

export async function POST() {
  try {
    const { url } = await startAuth();
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 2: Write `src/app/api/callback/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { finishAuth } from "../../../enablebanking/connection";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?error=missing_code", req.url));
  try {
    await finishAuth(code);
    return NextResponse.redirect(new URL("/settings?connected=1", req.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?error=auth_failed", req.url));
  }
}
```

- [ ] **Step 3: Write `src/app/api/sync/route.ts`**

```ts
import { NextResponse } from "next/server";
import { db } from "../../../db/index";
import { getSetting } from "../../../db/repositories/settings";
import { ebGet } from "../../../enablebanking/client";
import { syncAll } from "../../../enablebanking/sync";

export async function POST() {
  const uidsRaw = getSetting(db(), "account_uids");
  if (!uidsRaw) return NextResponse.json({ error: "not_connected" }, { status: 400 });
  try {
    const result = await syncAll(db(), {
      ebGet,
      accountUids: JSON.parse(uidsRaw) as string[],
      accountName: "CIC",
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
```

- [ ] **Step 4: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add -A && git commit -m "feat: API routes for connect/callback/sync"
```

---

## Task 13: App layout and navigation

**Files:**
- Create/Modify: `src/app/layout.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: a shared layout with a nav bar linking Dashboard, Transactions, Budgets, Categories, Settings.

- [ ] **Step 1: Write `src/app/layout.tsx`**

```tsx
import "./globals.css";
import Link from "next/link";

export const metadata = { title: "Budget CIC" };

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/categories", label: "Catégories" },
  { href: "/settings", label: "Réglages" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <nav className="nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href}>
              {n.label}
            </Link>
          ))}
        </nav>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Write minimal `src/app/globals.css`**

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, sans-serif; color: #1a1a1a; background: #f6f7f9; }
.nav { display: flex; gap: 1rem; padding: 1rem; background: #fff; border-bottom: 1px solid #e5e7eb; }
.nav a { text-decoration: none; color: #374151; font-weight: 500; }
.main { max-width: 900px; margin: 0 auto; padding: 1.5rem; }
.card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
.bar { height: 10px; border-radius: 6px; background: #e5e7eb; overflow: hidden; }
.bar > span { display: block; height: 100%; }
.alert { padding: .75rem 1rem; border-radius: 8px; margin-bottom: .5rem; }
.alert.warn { background: #fef3c7; }
.alert.danger { background: #fee2e2; }
table { width: 100%; border-collapse: collapse; }
td, th { text-align: left; padding: .5rem; border-bottom: 1px solid #f0f0f0; }
```

- [ ] **Step 3: Verify it builds and commit**

Run: `npm run build`
Expected: build succeeds.
```bash
git add -A && git commit -m "feat: app layout and navigation"
```

---

## Task 14: Dashboard page

**Files:**
- Create: `src/app/page.tsx`

**Interfaces:**
- Consumes: repositories, `computeEnvelopes`, `buildAlerts`, `getSetting`, `formatEur`. Server Component reading directly from SQLite.
- Produces: dashboard showing balance, current-month spend, alerts, envelope bars, recent transactions.

- [ ] **Step 1: Write `src/app/page.tsx`**

```tsx
import { db } from "../db/index";
import { totalBalance } from "../db/repositories/accounts";
import { listTransactions } from "../db/repositories/transactions";
import { listBudgets } from "../db/repositories/budgets";
import { getSetting } from "../db/repositories/settings";
import { computeEnvelopes } from "../lib/budget";
import { buildAlerts } from "../lib/alerts";
import { formatEur, monthKey } from "../lib/money";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const balance = totalBalance(database);
  const txns = listTransactions(database).map((t) => ({ date: t.date, amount: t.amount, category: t.category }));
  const budgets = listBudgets(database).map((b) => ({ category: b.category, month: b.month, limit: b.limit }));
  const envelopes = computeEnvelopes(txns, budgets, month);
  const threshold = Number.parseFloat(getSetting(database, "balance_threshold") ?? "0");
  const alerts = buildAlerts(envelopes, balance, threshold);

  const monthSpend = txns
    .filter((t) => monthKey(t.date) === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const recent = listTransactions(database).slice(0, 10);

  return (
    <div>
      <div className="card">
        <div style={{ fontSize: "2rem", fontWeight: 700 }}>{formatEur(balance)}</div>
        <div>Dépensé ce mois-ci : {formatEur(monthSpend)}</div>
      </div>

      {alerts.map((a, i) => (
        <div key={i} className={`alert ${a.level}`}>{a.message}</div>
      ))}

      <div className="card">
        <h3>Enveloppes ({month})</h3>
        {envelopes.length === 0 && <p>Aucun budget défini. Va dans « Budgets ».</p>}
        {envelopes.map((e) => (
          <div key={e.category} style={{ marginBottom: ".75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>{e.category}</span>
              <span>{formatEur(e.spent)} / {formatEur(e.limit)}</span>
            </div>
            <div className="bar">
              <span
                style={{
                  width: `${Math.min(100, e.ratio * 100)}%`,
                  background: e.ratio >= 1 ? "#ef4444" : e.ratio >= 0.8 ? "#f59e0b" : "#22c55e",
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Dernières transactions</h3>
        <table>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td>
                <td>{t.label}</td>
                <td>{t.category ?? "À catégoriser"}</td>
                <td style={{ textAlign: "right" }}>{formatEur(t.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it builds and commit**

Run: `npm run build`
Expected: build succeeds.
```bash
git add -A && git commit -m "feat: dashboard page"
```

---

## Task 15: Transactions page + recategorize action

**Files:**
- Create: `src/app/transactions/page.tsx`, `src/app/transactions/actions.ts`

**Interfaces:**
- Consumes: `listTransactions`, `listCategories`, `setTransactionCategory`, `ensureCategory`, `addRule`.
- Produces: a table of all transactions with a category `<select>` per row; a Server Action `recategorize(txnId, category, createRule)` that updates the transaction and optionally creates a keyword rule.

- [ ] **Step 1: Write `src/app/transactions/actions.ts`**

```ts
"use server";
import { db } from "../../db/index";
import { setTransactionCategory } from "../../db/repositories/transactions";
import { ensureCategory } from "../../db/repositories/categories";
import { addRule } from "../../db/repositories/rules";
import { revalidatePath } from "next/cache";

export async function recategorize(formData: FormData) {
  const txnId = String(formData.get("txnId"));
  const category = String(formData.get("category"));
  const label = String(formData.get("label") ?? "");
  const createRule = formData.get("createRule") === "on";
  const database = db();
  setTransactionCategory(database, txnId, ensureCategory(database, category));
  if (createRule && label) {
    const keyword = label.split(" ")[0]?.toUpperCase();
    if (keyword) addRule(database, keyword, category);
  }
  revalidatePath("/transactions");
}
```

- [ ] **Step 2: Write `src/app/transactions/page.tsx`**

```tsx
import { db } from "../../db/index";
import { listTransactions } from "../../db/repositories/transactions";
import { listCategories } from "../../db/repositories/categories";
import { formatEur } from "../../lib/money";
import { recategorize } from "./actions";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const txns = listTransactions(database);
  const categories = listCategories(database);

  return (
    <div className="card">
      <h2>Transactions</h2>
      <table>
        <thead>
          <tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th style={{ textAlign: "right" }}>Montant</th></tr>
        </thead>
        <tbody>
          {txns.map((t) => (
            <tr key={t.id}>
              <td>{t.date}</td>
              <td>{t.label}</td>
              <td>
                <form action={recategorize} style={{ display: "flex", gap: ".25rem" }}>
                  <input type="hidden" name="txnId" value={t.id} />
                  <input type="hidden" name="label" value={t.label} />
                  <select name="category" defaultValue={t.category ?? ""}>
                    <option value="" disabled>À catégoriser</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <label style={{ fontSize: ".75rem" }}>
                    <input type="checkbox" name="createRule" /> règle
                  </label>
                  <button type="submit">OK</button>
                </form>
              </td>
              <td style={{ textAlign: "right" }}>{formatEur(t.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds and commit**

Run: `npm run build`
Expected: build succeeds.
```bash
git add -A && git commit -m "feat: transactions page with recategorize action"
```

---

## Task 16: Budgets page

**Files:**
- Create: `src/app/budgets/page.tsx`, `src/app/budgets/actions.ts`

**Interfaces:**
- Consumes: `listCategories`, `listBudgets`, `setBudget`, `monthKey`.
- Produces: a form per category to set the current month's limit; a Server Action `saveBudget(category, limit)`.

- [ ] **Step 1: Write `src/app/budgets/actions.ts`**

```ts
"use server";
import { db } from "../../db/index";
import { setBudget } from "../../db/repositories/budgets";
import { monthKey } from "../../lib/money";
import { revalidatePath } from "next/cache";

export async function saveBudget(formData: FormData) {
  const category = String(formData.get("category"));
  const limit = Number.parseFloat(String(formData.get("limit")));
  const month = monthKey(new Date().toISOString().slice(0, 10));
  setBudget(db(), category, month, Number.isFinite(limit) ? limit : 0);
  revalidatePath("/budgets");
  revalidatePath("/");
}
```

- [ ] **Step 2: Write `src/app/budgets/page.tsx`**

```tsx
import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listBudgets } from "../../db/repositories/budgets";
import { monthKey } from "../../lib/money";
import { saveBudget } from "./actions";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const categories = listCategories(database);
  const budgets = listBudgets(database).filter((b) => b.month === month);
  const limitFor = (c: string) => budgets.find((b) => b.category === c)?.limit ?? "";

  return (
    <div className="card">
      <h2>Budgets — {month}</h2>
      {categories.map((c) => (
        <form key={c.id} action={saveBudget} style={{ display: "flex", gap: ".5rem", marginBottom: ".5rem" }}>
          <input type="hidden" name="category" value={c.name} />
          <span style={{ width: 160 }}>{c.name}</span>
          <input type="number" name="limit" step="0.01" defaultValue={limitFor(c.name)} placeholder="Plafond €" />
          <button type="submit">Enregistrer</button>
        </form>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds and commit**

Run: `npm run build`
Expected: build succeeds.
```bash
git add -A && git commit -m "feat: budgets page"
```

---

## Task 17: Categories & rules page

**Files:**
- Create: `src/app/categories/page.tsx`, `src/app/categories/actions.ts`

**Interfaces:**
- Consumes: `listCategories`, `ensureCategory`, `listRules`, `addRule`.
- Produces: list of categories + rules, a form to add a category, and a form to add a keyword rule.

- [ ] **Step 1: Write `src/app/categories/actions.ts`**

```ts
"use server";
import { db } from "../../db/index";
import { ensureCategory } from "../../db/repositories/categories";
import { addRule } from "../../db/repositories/rules";
import { revalidatePath } from "next/cache";

export async function addCategory(formData: FormData) {
  const name = String(formData.get("name")).trim();
  if (name) ensureCategory(db(), name);
  revalidatePath("/categories");
}

export async function createRule(formData: FormData) {
  const keyword = String(formData.get("keyword")).trim();
  const category = String(formData.get("category")).trim();
  if (keyword && category) addRule(db(), keyword.toUpperCase(), category);
  revalidatePath("/categories");
}
```

- [ ] **Step 2: Write `src/app/categories/page.tsx`**

```tsx
import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listRules } from "../../db/repositories/rules";
import { addCategory, createRule } from "./actions";

export const dynamic = "force-dynamic";

export default function CategoriesPage() {
  const database = db();
  const categories = listCategories(database);
  const rules = listRules(database);

  return (
    <div>
      <div className="card">
        <h2>Catégories</h2>
        <ul>{categories.map((c) => <li key={c.id}>{c.name}</li>)}</ul>
        <form action={addCategory} style={{ display: "flex", gap: ".5rem" }}>
          <input name="name" placeholder="Nouvelle catégorie" />
          <button type="submit">Ajouter</button>
        </form>
      </div>

      <div className="card">
        <h2>Règles de catégorisation</h2>
        <table>
          <thead><tr><th>Mot-clé</th><th>Catégorie</th></tr></thead>
          <tbody>{rules.map((r, i) => <tr key={i}><td>{r.keyword}</td><td>{r.category}</td></tr>)}</tbody>
        </table>
        <form action={createRule} style={{ display: "flex", gap: ".5rem", marginTop: ".5rem" }}>
          <input name="keyword" placeholder="Mot-clé (ex. DECATHLON)" />
          <select name="category" defaultValue="">
            <option value="" disabled>Catégorie</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <button type="submit">Ajouter la règle</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds and commit**

Run: `npm run build`
Expected: build succeeds.
```bash
git add -A && git commit -m "feat: categories and rules page"
```

---

## Task 18: Settings / connection page

**Files:**
- Create: `src/app/settings/page.tsx`, `src/app/settings/actions.ts`

**Interfaces:**
- Consumes: `getSetting`, `setSetting`, `listAccounts`. Calls `/api/connect` and `/api/sync` from the client.
- Produces: buttons to connect the bank and sync; the 90-day consent countdown; a form to set the balance alert threshold.

- [ ] **Step 1: Write `src/app/settings/actions.ts`**

```ts
"use server";
import { db } from "../../db/index";
import { setSetting } from "../../db/repositories/settings";
import { revalidatePath } from "next/cache";

export async function saveThreshold(formData: FormData) {
  const value = String(formData.get("threshold"));
  setSetting(db(), "balance_threshold", value);
  revalidatePath("/settings");
  revalidatePath("/");
}
```

- [ ] **Step 2: Write a small client component `src/app/settings/ConnectButtons.tsx`**

```tsx
"use client";
import { useState } from "react";

export function ConnectButtons() {
  const [msg, setMsg] = useState("");

  async function connect() {
    setMsg("Connexion…");
    const res = await fetch("/api/connect", { method: "POST" });
    const data = await res.json();
    if (data.url) window.location.href = data.url;
    else setMsg(`Erreur : ${data.error ?? "inconnue"}`);
  }

  async function sync() {
    setMsg("Synchronisation…");
    const res = await fetch("/api/sync", { method: "POST" });
    const data = await res.json();
    setMsg(res.ok ? `Importé : ${data.imported} transactions.` : `Erreur : ${data.error}`);
  }

  return (
    <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
      <button onClick={connect}>Connecter ma banque (CIC)</button>
      <button onClick={sync}>Synchroniser</button>
      <span>{msg}</span>
    </div>
  );
}
```

- [ ] **Step 3: Write `src/app/settings/page.tsx`**

```tsx
import { db } from "../../db/index";
import { getSetting } from "../../db/repositories/settings";
import { listAccounts } from "../../db/repositories/accounts";
import { saveThreshold } from "./actions";
import { ConnectButtons } from "./ConnectButtons";

export const dynamic = "force-dynamic";

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 3600 * 1000));
}

export default function SettingsPage() {
  const database = db();
  const validUntil = getSetting(database, "consent_valid_until");
  const days = daysUntil(validUntil);
  const threshold = getSetting(database, "balance_threshold") ?? "";
  const accounts = listAccounts(database);

  return (
    <div>
      <div className="card">
        <h2>Connexion bancaire</h2>
        <ConnectButtons />
        {days !== null && (
          <p className={days < 7 ? "alert danger" : ""}>
            Reconnexion à CIC nécessaire dans {days} jour(s).
          </p>
        )}
        {accounts.length > 0 && (
          <ul>{accounts.map((a) => <li key={a.id}>{a.name} — dernière synchro : {a.last_synced ?? "jamais"}</li>)}</ul>
        )}
      </div>

      <div className="card">
        <h2>Seuil d'alerte de solde</h2>
        <form action={saveThreshold} style={{ display: "flex", gap: ".5rem" }}>
          <input type="number" name="threshold" step="0.01" defaultValue={threshold} placeholder="ex. 200" />
          <button type="submit">Enregistrer</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Full build + test, then commit**

Run: `npm run build && npm test`
Expected: build succeeds; all tests PASS.
```bash
git add -A && git commit -m "feat: settings/connection page"
```

---

## Task 19: End-to-end Sandbox smoke test (manual)

**Files:** none (manual verification).

- [ ] **Step 1:** Place the downloaded RSA private key at `secrets/private_key.pem` and fill `.env.local` from `.env.local.example` with the real `ENABLEBANKING_APPLICATION_ID` (from the Sandbox app "Budgeti").
- [ ] **Step 2:** Run `npm run dev`, open `http://localhost:3000/settings`.
- [ ] **Step 3:** Click "Connecter ma banque" → complete the Sandbox bank's mock authentication → confirm redirect back to `/settings?connected=1`.
- [ ] **Step 4:** Click "Synchroniser" → confirm the imported count is non-zero.
- [ ] **Step 5:** Open `/` (dashboard) → confirm balance, envelopes, and recent transactions render; open `/transactions` and recategorize one row.
- [ ] **Step 6:** If any Enable Banking field name mismatches surface (from `connection.ts` note), fix the field names to match the live Sandbox response and re-run.

---

## Production switch-over (later, out of this plan's core)

When ready to connect the real CIC account:
1. In the Enable Banking Control Panel, create a **Production** app with redirect `https://localhost:3000/api/callback` and a GitHub repo URL for Privacy + Terms.
2. Update `.env.local`: new `ENABLEBANKING_APPLICATION_ID`, new key path, `ENABLEBANKING_REDIRECT_URL=https://localhost:3000/api/callback`.
3. Run the dev server over HTTPS: `next dev --experimental-https`.
4. Re-run the Task 19 smoke test against the real CIC login.

---

## Self-Review Notes

- **Spec coverage:** Aggregator/Enable Banking (Tasks 9–12, 19), Sandbox→Production strategy (Global Constraints + Production section), architecture Next.js+SQLite (Tasks 1–2), 90-day/limited-refresh/graceful-degradation (connection `valid_until`, settings countdown Task 18, route error handling Task 12), data model (Task 2), categorization + default rules + learn-a-rule (Tasks 4, 8, 15), envelopes (Tasks 5, 16), alerts (Tasks 6, 14), five screens (Tasks 13–18), error handling (Task 12 routes, Task 18 countdown), tests for logic + mocked integration (Tasks 3–11). All spec sections map to a task.
- **Out of scope confirmed:** no email/push, no hosting, no AI categorization, no payment initiation — matches spec §10.
- **Type consistency:** `Txn`/`Envelope`/`Budget`/`Rule`/`Alert` names are shared verbatim across `budget.ts`, `alerts.ts`, `categorize.ts`, and the pages that import them; repository signatures in Task 7 match their consumers in Tasks 11–18.
