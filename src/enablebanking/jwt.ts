import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";

export async function signRequestJwt(now = Math.floor(Date.now() / 1000)): Promise<string> {
  const appId = process.env.ENABLEBANKING_APPLICATION_ID;
  const keyPath = process.env.ENABLEBANKING_KEY_PATH;
  if (!appId)
    throw new Error("Enable Banking env var missing: ENABLEBANKING_APPLICATION_ID");
  if (!keyPath)
    throw new Error("Enable Banking env var missing: ENABLEBANKING_KEY_PATH");

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
