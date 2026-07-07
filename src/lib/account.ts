export function accountDisplayName(a: { name: string; custom_name: string | null }): string {
  return a.custom_name && a.custom_name.trim() !== "" ? a.custom_name : a.name;
}

export function accountLabel(a: {
  name: string;
  custom_name: string | null;
  iban_masked: string | null;
}): string {
  const base = accountDisplayName(a);
  return a.iban_masked ? `${base} ${a.iban_masked}` : base;
}
