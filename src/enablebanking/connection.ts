import { ebPost } from "./client";
import { db } from "../db/index";
import { setSetting } from "../db/repositories/settings";

const REDIRECT_URL = process.env.ENABLEBANKING_REDIRECT_URL ?? "http://localhost:3000/api/callback";

// NOTE: The exact request/response field names for /auth and /sessions must be
// confirmed against the live Enable Banking Sandbox during Task 19's smoke test.
// The shape below matches the documented v1 API; adjust field names if the Sandbox
// rejects them. The sync logic (Task 11, tested) is independent of these names.

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
