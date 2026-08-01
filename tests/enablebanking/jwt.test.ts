import { afterEach, expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { decodeProtectedHeader, decodeJwt } from "jose";

const keyPath = join(process.cwd(), "secrets", "test_key.pem");

// Restore env and clean up the ephemeral key so these mutations don't leak
// into other test files running in the same process.
afterEach(() => {
  delete process.env.ENABLEBANKING_APPLICATION_ID;
  delete process.env.ENABLEBANKING_KEY_PATH;
  delete process.env.ENABLEBANKING_PRIVATE_KEY;
  rmSync(keyPath, { force: true });
});

function newPem(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs8", format: "pem" }) as string;
}

test("signs a valid RS256 JWT with correct header and claims", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  mkdirSync(join(process.cwd(), "secrets"), { recursive: true });
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

// Hors de la machine de l'utilisateur, il n'y a pas de dossier `secrets/` : il est
// dans le .gitignore, donc jamais déployé — et l'y mettre reviendrait à publier une
// clé privée. La clé voyage alors dans une variable d'environnement, par sa valeur
// et non par son chemin.
test("signe à partir de la clé donnée en variable d'environnement, sans fichier", async () => {
  process.env.ENABLEBANKING_APPLICATION_ID = "app-123";
  process.env.ENABLEBANKING_PRIVATE_KEY = newPem();

  const { signRequestJwt } = await import("../../src/enablebanking/jwt");
  const token = await signRequestJwt(1_000_000);

  expect(decodeProtectedHeader(token)).toMatchObject({ alg: "RS256", kid: "app-123" });
});

// Une clé PEM tient sur plusieurs lignes. Beaucoup d'interfaces et de fichiers .env
// n'acceptent qu'une seule ligne et la rendent avec des « \n » écrits en toutes
// lettres ; importPKCS8 ne les reconnaît pas. On les rétablit plutôt que de laisser
// l'utilisateur face à une erreur de format illisible.
test("accepte une clé dont les retours à la ligne sont échappés", async () => {
  process.env.ENABLEBANKING_APPLICATION_ID = "app-123";
  process.env.ENABLEBANKING_PRIVATE_KEY = newPem().replace(/\n/g, "\\n");

  const { signRequestJwt } = await import("../../src/enablebanking/jwt");

  await expect(signRequestJwt(1_000_000)).resolves.toBeTypeOf("string");
});

// La variable prime sur le chemin : en production les deux peuvent être définies
// (le .env.local suit parfois le projet), et c'est celle qui voyage qui fait foi.
test("préfère la clé en variable au fichier quand les deux sont là", async () => {
  process.env.ENABLEBANKING_APPLICATION_ID = "app-123";
  process.env.ENABLEBANKING_KEY_PATH = join(process.cwd(), "secrets", "inexistant.pem");
  process.env.ENABLEBANKING_PRIVATE_KEY = newPem();

  const { signRequestJwt } = await import("../../src/enablebanking/jwt");

  await expect(signRequestJwt(1_000_000)).resolves.toBeTypeOf("string");
});

// Sans clé du tout, le message doit nommer les deux façons de la fournir : celui
// d'avant ne parlait que du chemin, et n'aidait pas hors de la machine.
test("dit comment fournir la clé quand elle manque", async () => {
  process.env.ENABLEBANKING_APPLICATION_ID = "app-123";

  const { signRequestJwt } = await import("../../src/enablebanking/jwt");

  await expect(signRequestJwt(1_000_000)).rejects.toThrow(
    /ENABLEBANKING_PRIVATE_KEY.*ENABLEBANKING_KEY_PATH/,
  );
});
