import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createDpapiStore, dpapiStore } from "./secret-store";

const ps7Modules = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "Modules");

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

  // Terminal pwsh, step "shell: pwsh" do CI ou tarefa que sobe pelo PowerShell 7: o filho herda o PSModulePath do 7, e o
  // Windows PowerShell 5.1 encontra o ConvertTo-SecureString la mas nao consegue carregar o modulo.
  it.runIf(existsSync(ps7Modules))("funciona com o PSModulePath do PowerShell 7 herdado do processo pai", async () => {
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"));
    const store = createDpapiStore({ ...inherited, PSModulePath: `${ps7Modules};${process.env.PSModulePath ?? ""}` });
    const blob = await store.protect("senha-com-pwsh");
    expect(await store.unprotect(blob)).toBe("senha-com-pwsh");
  });

  it("recusa texto que nao saiu da DPAPI", async () => {
    await expect(dpapiStore.unprotect("00ff")).rejects.toThrow();
    await expect(dpapiStore.unprotect("nao e hex")).rejects.toThrow();
  });
});
