import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Même alias que tsconfig.json ("@/*" → "./src/*"). Sans lui, tout module de src qui
  // importe en « @/… » échoue au chargement dans les tests, ce qui rendait les actions
  // serveur de /transactions intestables alors que TypeScript, lui, les résolvait.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
