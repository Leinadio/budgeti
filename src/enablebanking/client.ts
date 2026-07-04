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
