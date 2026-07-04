import { ebPost } from "./client";
import { db } from "../db/index";
import { setSetting } from "../db/repositories/settings";

const REDIRECT_URL = process.env.ENABLEBANKING_REDIRECT_URL ?? "http://localhost:3000/api/callback";

// The bank ("ASPSP") name must match Enable Banking's catalog for your environment
// EXACTLY. In Sandbox the real CIC is absent — use a test bank like "Mock ASPSP"
// (run `node scripts/list-aspsps.mjs` to see the valid names for your app). In
// Production, set ENABLEBANKING_ASPSP_NAME to the real bank (e.g. "CIC").
const ASPSP_NAME = process.env.ENABLEBANKING_ASPSP_NAME ?? "CIC";
const ASPSP_COUNTRY = process.env.ENABLEBANKING_ASPSP_COUNTRY ?? "FR";

// NOTE: The exact request/response field names for /auth and /sessions may still
// need confirming against the live API. The sync logic (tested) is independent of them.

export async function startAuth(): Promise<{ url: string; authId: string }> {
  // valid_until: 90-day consent window (max allowed by DSP2).
  const validUntil = new Date(Date.now() + 89 * 24 * 3600 * 1000).toISOString();
  const res = await ebPost<{ url: string; authorization_id: string }>("/auth", {
    access: { valid_until: validUntil },
    aspsp: { name: ASPSP_NAME, country: ASPSP_COUNTRY },
    state: "budget-cic",
    redirect_url: REDIRECT_URL,
    psu_type: "personal",
  });
  setSetting(db(), "consent_valid_until", validUntil);
  return { url: res.url, authId: res.authorization_id };
}

export async function finishAuth(code: string): Promise<string> {
  const res = await ebPost<{ session_id: string; accounts: { uid: string }[] }>("/sessions", { code });
  if (!res.session_id || !res.accounts) throw new Error("Enable Banking /sessions returned an unexpected response");
  setSetting(db(), "session_id", res.session_id);
  setSetting(db(), "account_uids", JSON.stringify(res.accounts.map((a) => a.uid)));
  return res.session_id;
}
