export type Rule = { keyword: string; category: string };

export function categorize(label: string, rules: Rule[]): string | null {
  const haystack = label.toUpperCase();
  for (const rule of rules) {
    if (haystack.includes(rule.keyword.toUpperCase())) return rule.category;
  }
  return null;
}
