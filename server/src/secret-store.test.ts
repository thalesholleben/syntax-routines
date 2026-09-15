import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createDpapiStore,
  createKeychainStore,
  createSecretServiceStore,
  createSecretStore,
  dpapiStore,
  type SecretCommand,
  type SecretStore
} from "./secret-store";

const ps7Modules = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "Modules");
const HARD_SECRETS = ["abcdefghijklmnop", "sénha € çã 'aspas' \"duplas\" $dolar `crase` \\barra", "  espaços nas pontas  ", "linha\nquebrada"];
const REFERENCE = /^(keychain|secret-service):[0-9a-f-]{36}$/;

/**
 * Processo auxiliar falso que se comporta como o security, o secret-tool e o PowerShell de verdade o bastante para
 * o store funcionar, e registra cada chamada: e assim que se prova que a senha nunca passa por argv.
 */
function fakeCommands() {
  const vault = new Map<string, string>();
  const calls: { bin: string; args: string[]; input: string }[] = [];
  const valueAfter = (tokens: string[], flag: string) => tokens[tokens.indexOf(flag) + 1];
  const run: SecretCommand = async (bin, args, input) => {
    calls.push({ bin, args, input });
    if (bin.endsWith("security")) {
      if (args[0] === "-i") {
        const tokens = input.trim().split(" ");
        vault.set(valueAfter(tokens, "-a"), valueAfter(tokens, "-w"));
        return "";
      }
      const account = valueAfter(args, "-a");
      if (!vault.has(account)) throw new Error("item nao existe");
      if (args[0] === "find-generic-password") return `${vault.get(account)}\n`;
      vault.delete(account);
      return "";
    }
    if (bin === "secret-tool") {
      const account = valueAfter(args, "account");
      if (args[0] === "store") vault.set(account, input);
      else if (args[0] === "lookup") {
        if (!vault.has(account)) throw new Error("item nao existe");
        return vault.get(account) ?? "";
      } else vault.delete(account);
      return "";
    }
    // PowerShell: "cifrar" e trocar o base64 por hex, "abrir" e o inverso.
    return args.at(-1)?.includes("ConvertFrom-SecureString") ? Buffer.from(input).toString("hex") : Buffer.from(input, "hex").toString("utf8");
  };
  return { run, calls, vault };
}

function expectNoSecretInArgv(calls: { args: string[] }[], secret: string): void {
  const argv = JSON.stringify(calls.map((call) => call.args));
  expect(argv).not.toContain(secret);
  expect(argv).not.toContain(Buffer.from(secret, "utf8").toString("base64"));
}

describe("cofres com processo auxiliar falso (todo sistema)", () => {
  const stores: [string, (run: SecretCommand) => SecretStore][] = [
    ["DPAPI", (run) => createDpapiStore({}, run)],
    ["Keychain", (run) => createKeychainStore({ run })],
    ["Secret Service", (run) => createSecretServiceStore({ run })]
  ];

  for (const [name, build] of stores) {
    it(`${name}: guarda e abre qualquer senha sem ela aparecer em argv`, async () => {
      const fake = fakeCommands();
      const store = build(fake.run);
      for (const secret of HARD_SECRETS) {
        const blob = await store.protect(secret);
        expect(blob).not.toContain(secret);
        expect(await store.unprotect(blob)).toBe(secret);
        expectNoSecretInArgv(fake.calls, secret);
      }
    });
  }

  it("Keychain e Secret Service: forget apaga o item, e a referencia deixa de abrir", async () => {
    for (const build of [(run: SecretCommand) => createKeychainStore({ run }), (run: SecretCommand) => createSecretServiceStore({ run })]) {
      const fake = fakeCommands();
      const store = build(fake.run);
      const blob = await store.protect("senha");
      expect(blob).toMatch(REFERENCE);
      await store.forget(blob);
      expect(fake.vault.size).toBe(0);
      await expect(store.unprotect(blob)).rejects.toThrow();
    }
  });

  it("referencia de outro cofre ou fora do formato e recusada antes de chamar qualquer processo", async () => {
    const fake = fakeCommands();
    const keychain = createKeychainStore({ run: fake.run });
    const secretService = createSecretServiceStore({ run: fake.run });
    // O id vem do randomUUID e nao de um literal: uuid escrito no arquivo tem entropia de segredo e o gitleaks reprova.
    const id = randomUUID();
    await expect(keychain.unprotect("00ff")).rejects.toThrow("formato inválido");
    await expect(keychain.unprotect(`secret-service:${id}`)).rejects.toThrow("formato inválido");
    await expect(secretService.unprotect(`keychain:${id}`)).rejects.toThrow("formato inválido");
    await expect(keychain.forget("keychain:; rm -rf ~")).rejects.toThrow("formato inválido");
    expect(fake.calls).toHaveLength(0);
  });

  it("Keychain que nao devolve o que foi gravado faz o protect falhar, mesmo com o security saindo 0", async () => {
    const store = createKeychainStore({ run: async (_bin, args) => (args[0] === "find-generic-password" ? "b3V0cmE=" : "") });
    await expect(store.protect("senha")).rejects.toThrow("o Keychain não guardou a senha");
  });

  it("Keychain recusa caminho de keychain com espaco ou aspas, que o modo interativo nao cita", () => {
    expect(() => createKeychainStore({ keychain: "/tmp/com espaco.keychain-db" })).toThrow();
    expect(() => createKeychainStore({ keychain: '/tmp/"aspas".keychain-db' })).toThrow();
  });

  it("sistema sem cofre suportado rejeita guardar e abrir, e forget nao falha", async () => {
    const store = createSecretStore("aix");
    await expect(store.protect("senha")).rejects.toThrow();
    await expect(store.unprotect("qualquer")).rejects.toThrow();
    await expect(store.forget("qualquer")).resolves.toBeUndefined();
  });
});

// DPAPI de verdade, com a chave do usuario que roda o teste (o CI roda no windows-latest). Cada chamada abre um PowerShell.
describe.runIf(process.platform === "win32")("dpapiStore", { timeout: 60_000 }, () => {
  it("cifra e abre de volta qualquer senha, e o texto cifrado nao contem a senha", async () => {
    for (const secret of HARD_SECRETS) {
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

// Keychain de verdade num keychain temporario: o login keychain do usuario (ou do runner do CI) nunca e tocado.
describe.runIf(process.platform === "darwin")("Keychain do macOS", { timeout: 60_000 }, () => {
  let dir = "";
  let keychain = "";
  const security = (...args: string[]) => {
    const result = spawnSync("/usr/bin/security", args, { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`security ${args[0]} saiu com ${result.status}: ${result.stderr}`);
  };

  beforeAll(() => {
    dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-keychain-")));
    keychain = path.join(dir, "teste.keychain-db");
    security("create-keychain", "-p", "senha-do-keychain-de-teste", keychain);
    security("unlock-keychain", "-p", "senha-do-keychain-de-teste", keychain);
    security("set-keychain-settings", keychain);
  });

  afterAll(() => {
    spawnSync("/usr/bin/security", ["delete-keychain", keychain]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("guarda, abre e apaga qualquer senha; o banco recebe so a referencia", async () => {
    const store = createKeychainStore({ keychain });
    for (const secret of HARD_SECRETS) {
      const blob = await store.protect(secret);
      expect(blob).toMatch(/^keychain:/);
      expect(await store.unprotect(blob)).toBe(secret);
      await store.forget(blob);
      await expect(store.unprotect(blob)).rejects.toThrow();
    }
  });
});

const hasSecretTool = process.platform === "linux" && spawnSync("sh", ["-c", "command -v secret-tool"]).status === 0;
const hasSessionBus = Boolean(process.env.DBUS_SESSION_BUS_ADDRESS);

// Secret Service de verdade: precisa do secret-tool e de um daemon de chaves na sessao (no CI, gnome-keyring dentro
// de dbus-run-session).
describe.runIf(hasSecretTool && hasSessionBus)("Secret Service do Linux", { timeout: 60_000 }, () => {
  it("guarda, abre e apaga qualquer senha; o banco recebe so a referencia", async () => {
    const store = createSecretServiceStore();
    for (const secret of HARD_SECRETS) {
      const blob = await store.protect(secret);
      expect(blob).toMatch(/^secret-service:/);
      expect(await store.unprotect(blob)).toBe(secret);
      await store.forget(blob);
      await expect(store.unprotect(blob)).rejects.toThrow();
    }
  });
});

// No CI de macOS e Linux o cofre real precisa rodar: sem esta trava, faltar o secret-tool viraria teste pulado em silencio.
describe.runIf(process.env.SR_REQUIRE_PLATFORM_TESTS === "1")("cofre de verdade exigido pelo CI", () => {
  it("o cofre deste sistema esta disponivel para os testes acima", () => {
    if (process.platform === "darwin") expect(existsSync("/usr/bin/security")).toBe(true);
    if (process.platform === "linux") expect({ hasSecretTool, hasSessionBus }).toEqual({ hasSecretTool: true, hasSessionBus: true });
    expect(["win32", "darwin", "linux"]).toContain(process.platform);
  });
});
