# Migration UI vers shadcn/ui — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer toute la couche présentation de l'app Budget CIC (CSS custom + HTML brut) par les composants shadcn/ui, avec thème clair et sombre suivant le système.

**Architecture:** Migration purement présentation. On ajoute Tailwind CSS v4 + les composants shadcn dans `src/components/ui/`, on réécrit le layout et les 5 pages. Les server actions, l'accès DB (`src/db`) et la logique (`src/lib`) ne changent pas. Les contrôles Radix qui ne se soumettent pas nativement (Select, Checkbox) sont enveloppés dans de petits composants client qui rendent un `<input type="hidden">` pour rester compatibles avec les server actions existantes.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS v4 (`@tailwindcss/postcss`), shadcn/ui (New York), Radix UI, lucide-react.

## Global Constraints

- Les server actions et leurs noms de champs restent inchangés : `recategorize` lit `category` et `createRule === "on"` ; `saveBudget` lit `category`/`limit` ; `addCategory` lit `name` ; `createRule` lit `keyword`/`category` ; `saveThreshold` lit `threshold`.
- L'accès DB (`src/db`) et la logique (`src/lib`) ne sont pas modifiés.
- `ConnectButtons` reste un composant client (`"use client"`).
- Alias d'import : `@/*` pointe vers `src/*` (déjà configuré dans `tsconfig.json`).
- Vérification finale sur le vrai serveur (`npm run dev`), pas seulement `npm test` (les DB `:memory:` ne voient pas les bugs runtime — cf. CLAUDE.md).
- Style shadcn : « New York ». Thème sombre piloté par le système (classe `dark` posée sur `<html>` par un script inline). Pas de bouton de bascule.

---

### Task 1: Tooling Tailwind v4 + tokens de thème + helper cn

**Files:**
- Modify: `package.json` (dépendances)
- Create: `postcss.config.mjs`
- Modify (remplacement complet): `src/app/globals.css`
- Create: `src/lib/utils.ts`

**Interfaces:**
- Produces: `cn(...inputs: ClassValue[]): string` depuis `@/lib/utils`, utilisé par tous les composants ui.
- Produces: variables CSS de thème (`--background`, `--foreground`, `--card`, `--card-foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`, `--destructive`, `--border`, `--input`, `--ring`, `--popover`, `--popover-foreground`, `--radius`) exposées comme utilitaires Tailwind (`bg-background`, `text-foreground`, `border-input`, etc.).

- [ ] **Step 1: Installer les dépendances**

```bash
npm install class-variance-authority clsx tailwind-merge lucide-react \
  @radix-ui/react-slot @radix-ui/react-select @radix-ui/react-checkbox \
  @radix-ui/react-label @radix-ui/react-progress
npm install -D tailwindcss @tailwindcss/postcss tw-animate-css
```

- [ ] **Step 2: Créer `postcss.config.mjs`**

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 3: Créer `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Remplacer entièrement `src/app/globals.css`**

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 5: Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (aucune erreur ; `@/lib/utils` résout).

- [ ] **Step 6: Vérifier que le serveur démarre sans erreur PostCSS**

Run: `npm run dev` (laisser démarrer ~5s, ouvrir http://localhost:3000, puis arrêter avec Ctrl-C)
Expected: la page se charge, le fond est clair (ou sombre si le système est en dark), aucune erreur PostCSS/Tailwind dans la console. Les pages existantes apparaissent non stylées (normal, le CSS custom a été retiré).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs src/app/globals.css src/lib/utils.ts
git commit -m "build: setup Tailwind v4 + tokens de theme shadcn"
```

---

### Task 2: Composants shadcn/ui + wrappers de formulaire

**Files:**
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/table.tsx`
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/progress.tsx`
- Create: `src/components/ui/checkbox.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/category-select-field.tsx`
- Create: `src/components/rule-checkbox-field.tsx`

**Interfaces:**
- Consumes: `cn` depuis `@/lib/utils` (Task 1).
- Produces: `Button` (+ prop `asChild`, `variant`, `size`), `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Input`, `Label`, `Badge` (+ `variant`), `Progress` (props `value: number`, `indicatorClassName?: string`), `Checkbox` (props Radix : `checked`, `onCheckedChange`), `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`.
- Produces: `CategorySelectField({ name, categories, defaultValue?, placeholder? })` — rend un Select shadcn + `<input type="hidden" name={name} value={valeur}>`. `categories: string[]`.
- Produces: `RuleCheckboxField({ name, label })` — rend un Checkbox shadcn ; quand coché, rend `<input type="hidden" name={name} value="on">`.

- [ ] **Step 1: Créer `src/components/ui/button.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90",
        outline: "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
```

- [ ] **Step 2: Créer `src/components/ui/card.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        className
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-header" className={cn("flex flex-col gap-1.5 px-6", className)} {...props} />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-title" className={cn("leading-none font-semibold", className)} {...props} />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardContent };
```

- [ ] **Step 3: Créer `src/components/ui/table.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("hover:bg-muted/50 border-b transition-colors", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap",
        className
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td data-slot="table-cell" className={cn("p-2 align-middle whitespace-nowrap", className)} {...props} />
  );
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
```

- [ ] **Step 4: Créer `src/components/ui/input.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        className
      )}
      {...props}
    />
  );
}

export { Input };
```

- [ ] **Step 5: Créer `src/components/ui/label.tsx`**

```tsx
"use client";
import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/utils";

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

export { Label };
```

- [ ] **Step 6: Créer `src/components/ui/badge.tsx`**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-white",
        outline: "text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
```

- [ ] **Step 7: Créer `src/components/ui/progress.tsx`**

Note : ce composant expose une prop `indicatorClassName` (absente du shadcn standard) pour colorer la barre selon le ratio de dépense sur le Dashboard.

```tsx
"use client";
import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn("bg-primary/20 relative h-2 w-full overflow-hidden rounded-full", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn("bg-primary h-full w-full flex-1 transition-all", indicatorClassName)}
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
```

- [ ] **Step 8: Créer `src/components/ui/checkbox.tsx`**

```tsx
"use client";
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-input size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:border-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
```

- [ ] **Step 9: Créer `src/components/ui/select.tsx`**

```tsx
"use client";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & { size?: "sm" | "default" }) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.ScrollUpButton className="flex cursor-default items-center justify-center py-1">
          <ChevronUpIcon className="size-4" />
        </SelectPrimitive.ScrollUpButton>
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectPrimitive.ScrollDownButton className="flex cursor-default items-center justify-center py-1">
          <ChevronDownIcon className="size-4" />
        </SelectPrimitive.ScrollDownButton>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
```

- [ ] **Step 10: Créer `src/components/category-select-field.tsx`**

```tsx
"use client";
import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CategorySelectField({
  name,
  categories,
  defaultValue = "",
  placeholder = "À catégoriser",
  className,
}: {
  name: string;
  categories: string[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value || undefined} onValueChange={setValue}>
        <SelectTrigger size="sm" className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
```

- [ ] **Step 11: Créer `src/components/rule-checkbox-field.tsx`**

```tsx
"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function RuleCheckboxField({ name, label }: { name: string; label: string }) {
  const [checked, setChecked] = React.useState(false);
  return (
    <Label className="text-xs font-normal">
      <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
      {checked && <input type="hidden" name={name} value="on" />}
      {label}
    </Label>
  );
}
```

- [ ] **Step 12: Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (aucune erreur de type sur les 11 fichiers créés).

- [ ] **Step 13: Commit**

```bash
git add src/components
git commit -m "feat: composants shadcn/ui + wrappers de formulaire"
```

---

### Task 3: Layout (navigation + thème système)

**Files:**
- Modify (remplacement complet): `src/app/layout.tsx`

**Interfaces:**
- Consumes: `Button` depuis `@/components/ui/button` (Task 2).

- [ ] **Step 1: Remplacer `src/app/layout.tsx`**

```tsx
import "./globals.css";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Budget CIC" };

const NAV = [
  { href: "/", label: "Tableau de bord" },
  { href: "/transactions", label: "Transactions" },
  { href: "/budgets", label: "Budgets" },
  { href: "/categories", label: "Catégories" },
  { href: "/settings", label: "Réglages" },
];

const themeScript =
  "document.documentElement.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches)";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <nav className="flex flex-wrap gap-1 border-b bg-card px-4 py-2">
          {NAV.map((n) => (
            <Button key={n.href} asChild variant="ghost" size="sm">
              <Link href={n.href}>{n.label}</Link>
            </Button>
          ))}
        </nav>
        <main className="mx-auto max-w-3xl px-6 py-6">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Vérifier visuellement**

Run: `npm run dev` puis ouvrir http://localhost:3000
Expected: barre de navigation avec liens style boutons ghost, contenu centré (max-width). En mode système sombre, fond sombre et texte clair. Arrêter le serveur.

- [ ] **Step 3: Commit**

```bash
git add src/app/layout.tsx
git commit -m "feat: layout shadcn (nav + theme systeme)"
```

---

### Task 4: Dashboard

**Files:**
- Modify (remplacement complet du JSX): `src/app/page.tsx`

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Progress`, `Table`/`TableBody`/`TableRow`/`TableCell` (Task 2), `cn` (Task 1).
- Toute la logique de calcul (balance, envelopes, alerts, monthSpend, accountLabel) reste identique à l'actuelle.

- [ ] **Step 1: Remplacer `src/app/page.tsx`**

```tsx
import { db } from "../db/index";
import { totalBalance, listAccounts } from "../db/repositories/accounts";
import { listTransactions } from "../db/repositories/transactions";
import { listBudgets } from "../db/repositories/budgets";
import { getSetting } from "../db/repositories/settings";
import { computeEnvelopes } from "../lib/budget";
import { buildAlerts } from "../lib/alerts";
import { formatEur, monthKey } from "../lib/money";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default function Dashboard() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const balance = totalBalance(database);
  const accounts = listAccounts(database);
  const allTxns = listTransactions(database);
  const txns = allTxns.map((t) => ({ date: t.date, amount: t.amount, category: t.category }));
  const budgets = listBudgets(database).map((b) => ({ category: b.category, month: b.month, limit: b.limit }));
  const envelopes = computeEnvelopes(txns, budgets, month);
  const threshold = Number.parseFloat(getSetting(database, "balance_threshold") ?? "0");
  const alerts = buildAlerts(envelopes, balance, threshold);

  const monthSpend = txns
    .filter((t) => monthKey(t.date) === month && t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const accountLabel = (a: (typeof accounts)[number]) =>
    a.iban_masked ? `${a.name} ${a.iban_masked}` : a.name;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="text-3xl font-bold">{formatEur(balance)}</div>
          <div className="text-muted-foreground text-sm">
            Solde total ({accounts.length} compte{accounts.length > 1 ? "s" : ""})
          </div>
          <div className="text-muted-foreground text-sm">
            Dépensé ce mois-ci : {formatEur(monthSpend)}
          </div>
        </CardContent>
      </Card>

      {alerts.map((a, i) => (
        <div
          key={i}
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            a.level === "danger"
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
          )}
        >
          {a.message}
        </div>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Enveloppes ({month})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {envelopes.length === 0 && (
            <p className="text-muted-foreground text-sm">Aucun budget défini. Va dans « Budgets ».</p>
          )}
          {envelopes.map((e) => (
            <div key={e.category} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{e.category}</span>
                <span>
                  {formatEur(e.spent)} / {formatEur(e.limit)}
                </span>
              </div>
              <Progress
                value={Math.min(100, e.ratio * 100)}
                indicatorClassName={
                  e.ratio >= 1 ? "bg-red-500" : e.ratio >= 0.8 ? "bg-amber-500" : "bg-green-500"
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {accounts.map((a) => {
        const accountTxns = allTxns.filter((t) => t.accountId === a.id).slice(0, 8);
        return (
          <Card key={a.id}>
            <CardHeader className="flex-row items-baseline justify-between">
              <CardTitle>{accountLabel(a)}</CardTitle>
              <span className="text-xl font-bold">{formatEur(a.balance)}</span>
            </CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {accountTxns.length === 0 && (
                    <TableRow>
                      <TableCell className="text-muted-foreground">Aucune transaction.</TableCell>
                    </TableRow>
                  )}
                  {accountTxns.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground">{t.date}</TableCell>
                      <TableCell>{t.label}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t.category ?? "À catégoriser"}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier visuellement**

Run: `npm run dev` puis ouvrir http://localhost:3000
Expected: carte solde, alertes colorées, barres d'enveloppes colorées selon le ratio (vert/ambre/rouge), une carte par compte avec table de transactions. Arrêter le serveur.

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: dashboard shadcn (Card, Progress, Table)"
```

---

### Task 5: Transactions

**Files:**
- Modify (remplacement complet du JSX): `src/app/transactions/page.tsx`

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Button` (Task 2), `CategorySelectField` et `RuleCheckboxField` (Task 2).
- Le `<form action={recategorize}>` est conservé ; `CategorySelectField` fournit `name="category"`, `RuleCheckboxField` fournit `name="createRule"`. Les hidden `txnId` et `label` restent des `<input>`.
- Le regroupement par compte (`groups`) reste identique.

- [ ] **Step 1: Remplacer `src/app/transactions/page.tsx`**

```tsx
import { db } from "../../db/index";
import { listTransactions, type TxnView } from "../../db/repositories/transactions";
import { listCategories } from "../../db/repositories/categories";
import { formatEur } from "../../lib/money";
import { recategorize } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { CategorySelectField } from "@/components/category-select-field";
import { RuleCheckboxField } from "@/components/rule-checkbox-field";

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const database = db();
  const txns = listTransactions(database);
  const categories = listCategories(database).map((c) => c.name);

  // Group transactions by account, preserving date order within each group.
  const groups = new Map<string, { label: string; items: TxnView[] }>();
  for (const t of txns) {
    const g = groups.get(t.accountId) ?? { label: t.accountLabel ?? "Compte", items: [] };
    g.items.push(t);
    groups.set(t.accountId, g);
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.size === 0 && (
        <Card>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Aucune transaction. Va dans Réglages pour synchroniser.
            </p>
          </CardContent>
        </Card>
      )}
      {[...groups.values()].map((group) => (
        <Card key={group.label}>
          <CardHeader>
            <CardTitle>{group.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Catégorie</TableHead>
                  <TableHead className="text-right">Montant</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.items.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-muted-foreground">{t.date}</TableCell>
                    <TableCell>{t.label}</TableCell>
                    <TableCell>
                      <form action={recategorize} className="flex items-center gap-2">
                        <input type="hidden" name="txnId" value={t.id} />
                        <input type="hidden" name="label" value={t.label} />
                        <CategorySelectField
                          name="category"
                          categories={categories}
                          defaultValue={t.category ?? ""}
                        />
                        <RuleCheckboxField name="createRule" label="règle" />
                        <Button type="submit" size="sm" variant="secondary">
                          OK
                        </Button>
                      </form>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatEur(t.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. Note : `listCategories` renvoie des objets `{ id, name }` ; on mappe vers `string[]` via `.map((c) => c.name)` avant de passer à `CategorySelectField`.

- [ ] **Step 3: Vérifier visuellement (recatégorisation fonctionnelle)**

Run: `npm run dev` puis ouvrir http://localhost:3000/transactions
Expected: une carte par compte, table avec le Select de catégorie (shadcn), la case « règle », le bouton OK. Choisir une catégorie et cliquer OK doit persister (la page se recharge, la catégorie affichée dans les autres vues change). Arrêter le serveur.

- [ ] **Step 4: Commit**

```bash
git add src/app/transactions/page.tsx
git commit -m "feat: transactions shadcn (Table, Select, Checkbox via wrappers)"
```

---

### Task 6: Budgets

**Files:**
- Modify (remplacement complet du JSX): `src/app/budgets/page.tsx`

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Input`, `Button`, `Label` (Task 2).
- Le `<form action={saveBudget}>` par catégorie est conservé (hidden `category`, input `limit`).

- [ ] **Step 1: Remplacer `src/app/budgets/page.tsx`**

```tsx
import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listBudgets } from "../../db/repositories/budgets";
import { monthKey } from "../../lib/money";
import { saveBudget } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default function BudgetsPage() {
  const database = db();
  const month = monthKey(new Date().toISOString().slice(0, 10));
  const categories = listCategories(database);
  const budgets = listBudgets(database).filter((b) => b.month === month);
  const limitFor = (c: string) => budgets.find((b) => b.category === c)?.limit ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Budgets — {month}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {categories.map((c) => (
          <form key={c.id} action={saveBudget} className="flex items-center gap-2">
            <input type="hidden" name="category" value={c.name} />
            <Label className="w-40 font-normal">{c.name}</Label>
            <Input
              type="number"
              name="limit"
              step="0.01"
              defaultValue={limitFor(c.name)}
              placeholder="Plafond €"
              className="max-w-40"
            />
            <Button type="submit" size="sm">
              Enregistrer
            </Button>
          </form>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Vérifier visuellement**

Run: `npm run dev` puis ouvrir http://localhost:3000/budgets
Expected: une carte avec une ligne par catégorie (label + champ nombre + bouton). Enregistrer un plafond persiste (visible sur le Dashboard). Arrêter le serveur.

- [ ] **Step 3: Commit**

```bash
git add src/app/budgets/page.tsx
git commit -m "feat: budgets shadcn (Input, Label, Button)"
```

---

### Task 7: Catégories

**Files:**
- Modify (remplacement complet du JSX): `src/app/categories/page.tsx`

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Input`, `Button` (Task 2), `CategorySelectField` (Task 2).
- Les `<form action={addCategory}>` (input `name`) et `<form action={createRule}>` (input `keyword` + select `category`) sont conservés. `CategorySelectField name="category"` fournit la valeur du select de règle.

- [ ] **Step 1: Remplacer `src/app/categories/page.tsx`**

```tsx
import { db } from "../../db/index";
import { listCategories } from "../../db/repositories/categories";
import { listRules } from "../../db/repositories/rules";
import { addCategory, createRule } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CategorySelectField } from "@/components/category-select-field";

export const dynamic = "force-dynamic";

export default function CategoriesPage() {
  const database = db();
  const categories = listCategories(database);
  const categoryNames = categories.map((c) => c.name);
  const rules = listRules(database);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Catégories</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="list-inside list-disc text-sm">
            {categories.map((c) => (
              <li key={c.id}>{c.name}</li>
            ))}
          </ul>
          <form action={addCategory} className="flex items-center gap-2">
            <Input name="name" placeholder="Nouvelle catégorie" className="max-w-60" />
            <Button type="submit" size="sm">
              Ajouter
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Règles de catégorisation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mot-clé</TableHead>
                <TableHead>Catégorie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.keyword}</TableCell>
                  <TableCell>{r.category}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <form action={createRule} className="flex items-center gap-2">
            <Input name="keyword" placeholder="Mot-clé (ex. DECATHLON)" className="max-w-60" />
            <CategorySelectField name="category" categories={categoryNames} placeholder="Catégorie" />
            <Button type="submit" size="sm">
              Ajouter la règle
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Vérifier visuellement**

Run: `npm run dev` puis ouvrir http://localhost:3000/categories
Expected: carte liste des catégories + ajout ; carte règles avec table + form (Input mot-clé, Select catégorie, bouton). Ajouter une catégorie et une règle persiste. Arrêter le serveur.

- [ ] **Step 3: Commit**

```bash
git add src/app/categories/page.tsx
git commit -m "feat: categories shadcn (Table, Input, Select)"
```

---

### Task 8: Réglages + ConnectButtons

**Files:**
- Modify (remplacement complet du JSX): `src/app/settings/page.tsx`
- Modify (remplacement complet): `src/app/settings/ConnectButtons.tsx`

**Interfaces:**
- Consumes: `Card`/`CardHeader`/`CardTitle`/`CardContent`, `Badge`, `Input`, `Button` (Task 2).
- `ConnectButtons` reste `"use client"`, garde la logique `fetch("/api/connect")` et `fetch("/api/sync")` inchangée, remplace seulement les `<button>` par `Button` et le message par un `<span>` stylé.
- Le `<form action={saveThreshold}>` (input `threshold`) est conservé. `daysUntil` inchangé.

- [ ] **Step 1: Remplacer `src/app/settings/ConnectButtons.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ConnectButtons() {
  const [msg, setMsg] = useState("");

  async function connect() {
    setMsg("Connexion…");
    try {
      const res = await fetch("/api/connect", { method: "POST" });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setMsg(`Erreur : ${data.error ?? "inconnue"}`);
    } catch {
      setMsg("Erreur réseau : impossible de contacter le serveur.");
    }
  }

  async function sync() {
    setMsg("Synchronisation…");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      setMsg(res.ok ? `Importé : ${data.imported} transactions.` : `Erreur : ${data.error}`);
    } catch {
      setMsg("Erreur réseau : impossible de contacter le serveur.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={connect}>Connecter ma banque (CIC)</Button>
      <Button onClick={sync} variant="secondary">
        Synchroniser
      </Button>
      {msg && <span className="text-muted-foreground text-sm">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Remplacer `src/app/settings/page.tsx`**

```tsx
import { db } from "../../db/index";
import { getSetting } from "../../db/repositories/settings";
import { listAccounts } from "../../db/repositories/accounts";
import { saveThreshold } from "./actions";
import { ConnectButtons } from "./ConnectButtons";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Connexion bancaire</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ConnectButtons />
          {days !== null && (
            <Badge variant={days < 7 ? "destructive" : "secondary"}>
              Reconnexion à CIC nécessaire dans {days} jour(s).
            </Badge>
          )}
          {accounts.length > 0 && (
            <ul className="text-muted-foreground list-inside list-disc text-sm">
              {accounts.map((a) => (
                <li key={a.id}>
                  {a.name} — dernière synchro : {a.last_synced ?? "jamais"}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seuil d'alerte de solde</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveThreshold} className="flex items-center gap-2">
            <Input
              type="number"
              name="threshold"
              step="0.01"
              defaultValue={threshold}
              placeholder="ex. 200"
              className="max-w-40"
            />
            <Button type="submit" size="sm">
              Enregistrer
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Vérifier visuellement**

Run: `npm run dev` puis ouvrir http://localhost:3000/settings
Expected: carte connexion (boutons Connecter/Synchroniser, badge reconnexion, liste des comptes) ; carte seuil (champ + bouton). Enregistrer un seuil persiste. Arrêter le serveur.

- [ ] **Step 4: Commit**

```bash
git add src/app/settings/page.tsx src/app/settings/ConnectButtons.tsx
git commit -m "feat: reglages shadcn (Card, Badge, Input, Button)"
```

---

### Task 9: Vérification finale

**Files:** aucun changement de code attendu (tâche de contrôle).

- [ ] **Step 1: Vérifier qu'aucune classe CSS custom retirée ne subsiste**

Run: `grep -rn 'className="\(nav\|card\|bar\|alert\|main\)"' src/ ; grep -rn 'className={\`alert' src/`
Expected: aucun résultat (toutes les anciennes classes ont été remplacées).

- [ ] **Step 2: Typecheck complet**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Tests unitaires**

Run: `npm test`
Expected: PASS (les tests `src/lib`/`src/db` ne sont pas impactés par la migration UI).

- [ ] **Step 4: Contrôle visuel de bout en bout**

Run: `npm run dev` puis parcourir les 5 écrans (/, /transactions, /budgets, /categories, /settings) en clair et en sombre (basculer le thème système).
Expected: chaque écran est stylé via shadcn, lisible dans les deux thèmes, aucune erreur console. Arrêter le serveur.

- [ ] **Step 5: Commit final (si des ajustements ont été nécessaires)**

```bash
git add -A
git commit -m "chore: verification finale migration shadcn"
```

---

## Self-Review

- **Couverture du spec :** tooling Tailwind+shadcn (Task 1-2), thème clair+sombre système (Task 1 tokens + Task 3 script), les 9 composants listés (Task 2), les 5 pages + layout + ConnectButtons (Task 3-8), server actions préservées (wrappers Task 2, utilisés Task 5/7), vérification serveur réel (Task 9). Hors périmètre (toggle manuel, logique métier) respecté.
- **Compatibilité server actions :** Select et Checkbox Radix ne se soumettent pas nativement — résolu par `CategorySelectField` (hidden input `category`) et `RuleCheckboxField` (hidden input `createRule=on` quand coché), ce qui correspond exactement à ce que lisent `recategorize`/`createRule`/`saveBudget`.
- **Cohérence des types :** `listCategories` renvoie `{ id, name }[]` ; partout où `CategorySelectField` est utilisé, on passe `categories.map((c) => c.name)` (`string[]`). `Progress` expose `indicatorClassName` défini en Task 2 et utilisé en Task 4.
- **Pas de placeholder :** chaque étape contient le code complet.
```
