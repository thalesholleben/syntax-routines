import { describe, expect, it } from "vitest";

import { dpapiStore } from "./secret-store";

// DPAPI de verdade, com a chave do usuario que roda o teste (o CI roda no windows-latest). Cada chamada abre um PowerShell.
describe.runIf(process.platform === "win32")("dpapiStore", { timeout: 60_000 }, () => {
  it("cifra e abre de volta qualquer senha, e o texto cifrado nao contem a senha", async () => {
    for (const secret of ["abcdefghijklmnop", "sénha € çã 'aspas' \"duplas\" $dolar `crase` \\barra", "  espaços nas pontas  "]) {
      const blob = await dpapiStore.protect(secret);
      expect(blob).toMatch(/^[0-9a-f]+$/i);
      expect(blob).not.toContain(secret);
      expect(await dpapiStore.unprotect(blob)).toBe(secret);
    }
  });

  it("recusa texto que nao saiu da DPAPI", async () => {
    await expect(dpapiStore.unprotect("00ff")).rejects.toThrow();
    await expect(dpapiStore.unprotect("nao e hex")).rejects.toThrow();
  });
});
