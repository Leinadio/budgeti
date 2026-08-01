import { readFileSync } from "node:fs";
import { importPKCS8, SignJWT } from "jose";

// La clé de signature Enable Banking, par sa valeur ou par son chemin.
//
// Sur la machine de l'utilisateur elle vit dans `secrets/`, et ENABLEBANKING_KEY_PATH
// dit où. Ailleurs, ce dossier n'existe pas : il est dans le .gitignore, donc jamais
// déployé — et l'y mettre reviendrait à publier une clé privée. La clé voyage alors
// dans ENABLEBANKING_PRIVATE_KEY, qui prime : quand les deux sont là, c'est celle qui
// a voyagé avec l'app qui fait foi, le chemin n'étant qu'un reste du poste local.
function readPrivateKey(): string {
  const inline = process.env.ENABLEBANKING_PRIVATE_KEY;
  // Un PEM tient sur plusieurs lignes, que beaucoup d'interfaces et de fichiers .env
  // rendent avec des « \n » écrits en toutes lettres. importPKCS8 ne les reconnaît
  // pas : on les rétablit, plutôt qu'une erreur de format illisible.
  if (inline) return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  const keyPath = process.env.ENABLEBANKING_KEY_PATH;
  if (!keyPath)
    throw new Error(
      "Enable Banking : clé privée absente. Donner son contenu dans ENABLEBANKING_PRIVATE_KEY, ou son chemin dans ENABLEBANKING_KEY_PATH.",
    );
  return readFileSync(keyPath, "utf8");
}

export async function signRequestJwt(now = Math.floor(Date.now() / 1000)): Promise<string> {
  const appId = process.env.ENABLEBANKING_APPLICATION_ID;
  if (!appId)
    throw new Error("Enable Banking env var missing: ENABLEBANKING_APPLICATION_ID");

  const key = await importPKCS8(readPrivateKey(), "RS256");

  return new SignJWT({})
    .setProtectedHeader({ typ: "JWT", alg: "RS256", kid: appId })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
}
