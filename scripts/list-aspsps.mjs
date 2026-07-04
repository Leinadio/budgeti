// Liste les banques (ASPSP) disponibles pour ton application Enable Banking.
// Usage :  node scripts/list-aspsps.mjs
//
// Il lit ./.env.local (APPLICATION_ID + chemin de la clé), signe un JWT, et
// interroge l'API. Sert à trouver le NOM EXACT à utiliser pour ta banque —
// utile car l'erreur "Wrong ASPSP name provided" signifie que le nom envoyé
// (par défaut "CIC") ne correspond pas au catalogue de ton environnement.

import { readFileSync } from "node:fs";
import { SignJWT, importPKCS8 } from "jose";

function loadEnvLocal() {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  } catch {
    console.error("❌ Impossible de lire .env.local — es-tu bien à la racine du projet ?");
    process.exit(1);
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return env;
}

const env = loadEnvLocal();
const appId = env.ENABLEBANKING_APPLICATION_ID;
const keyPath = env.ENABLEBANKING_KEY_PATH || "./secrets/private_key.pem";

if (!appId) {
  console.error("❌ ENABLEBANKING_APPLICATION_ID manquant dans .env.local");
  process.exit(1);
}

const pem = readFileSync(new URL("../" + keyPath.replace(/^\.\//, ""), import.meta.url), "utf8");
const key = await importPKCS8(pem, "RS256");
const now = Math.floor(Date.now() / 1000);
const jwt = await new SignJWT({})
  .setProtectedHeader({ typ: "JWT", alg: "RS256", kid: appId })
  .setIssuer("enablebanking.com")
  .setAudience("api.enablebanking.com")
  .setIssuedAt(now)
  .setExpirationTime(now + 3600)
  .sign(key);

const res = await fetch("https://api.enablebanking.com/aspsps?country=FR", {
  headers: { Authorization: `Bearer ${jwt}` },
});

if (!res.ok) {
  console.error(`❌ HTTP ${res.status}:`, await res.text());
  process.exit(1);
}

const data = await res.json();
const list = data.aspsps || data || [];
console.log(`\n✅ ${list.length} banque(s) disponible(s) pour la France :\n`);
for (const a of list) {
  const name = a.name ?? "(sans nom)";
  const country = a.country ?? "?";
  const sandbox = a.sandbox === true ? "  [SANDBOX]" : "";
  console.log(`  • name: "${name}"   country: ${country}${sandbox}`);
}
console.log(
  '\n👉 Cherche la ligne qui correspond à ta banque (ou une banque de test).' +
    '\n   Le "name" entre guillemets est la valeur exacte à utiliser.\n',
);
