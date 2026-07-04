import { expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { decodeProtectedHeader, decodeJwt } from "jose";

test("signs a valid RS256 JWT with correct header and claims", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  mkdirSync(join(process.cwd(), "secrets"), { recursive: true });
  const keyPath = join(process.cwd(), "secrets", "test_key.pem");
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
