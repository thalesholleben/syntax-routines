// Senha do e-mail salva pelo painel, guardada pelo cofre do proprio sistema e nunca em claro no banco:
//   Windows: DPAPI no escopo do usuario, pelo Windows PowerShell; o banco guarda o texto cifrado (hex).
//   macOS:   Keychain do usuario, pelo /usr/bin/security; o banco guarda so a referencia `keychain:<uuid>`.
//   Linux:   Secret Service (GNOME Keyring, KWallet), pelo secret-tool; o banco guarda `secret-service:<uuid>`.
// Nos tres o segredo vai e volta so pelo stdin/stdout, em base64: nada em argv (visivel em ps e no Gerenciador de
// Tarefas), nada em arquivo, e o texto de erro do processo auxiliar nao e repassado (ele pode citar o comando).
// O banco copiado para outro PC ou outro usuario nao abre a senha: vira o motivo "secret" e pede configurar de novo.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

export interface SecretStore {
  protect: (plain: string) => Promise<string>;
  unprotect: (blob: string) => Promise<string>;
  /** Apaga o que o protect guardou fora do banco. Na DPAPI o blob ja e o segredo cifrado: nada a apagar. */
  forget: (blob: string) => Promise<void>;
}

/** Roda o processo auxiliar do cofre com `input` no stdin e devolve o stdout. Injetavel: o teste confere o argv. */
export type SecretCommand = (bin: string, args: string[], input: string, env?: NodeJS.ProcessEnv) => Promise<string>;

const TIMEOUT_MS = 30_000;
const HEX = /^[0-9a-f]+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Servico e rotulo do item, iguais no Keychain e no Secret Service. Sem espaco: o modo -i do security nao cita nada. */
const SERVICE = "syntax-routines-smtp";

export const runSecretCommand: SecretCommand = (bin, args, input, env = process.env) =>
  new Promise((resolve, reject) => {
    const name = path.basename(bin);
    let isSettled = false;
    const settle = (error: Error | null, value = "") => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const child = spawn(bin, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env });
    const timer = setTimeout(() => {
      child.kill();
      settle(new Error(`o ${name} não respondeu a tempo`));
    }, TIMEOUT_MS);
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    // Sem o programa (ou ele morrendo antes de ler), a escrita no stdin falha com EPIPE: vira rejeicao, nao crash.
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => settle(new Error(`o ${name} não pôde ser executado: ${error.message}`)));
    child.on("close", (code) => settle(code === 0 ? null : new Error(`o ${name} saiu com código ${code}`), stdout.trim()));
    child.stdin.end(input);
  });

const toBase64 = (plain: string) => Buffer.from(plain, "utf8").toString("base64");
const fromBase64 = (text: string) => Buffer.from(text.trim(), "base64").toString("utf8");

// ConvertFrom-SecureString sem -Key usa a DPAPI do usuario atual e devolve hex.
const PROTECT =
  "$ErrorActionPreference = 'Stop'; $in = [Console]::In.ReadToEnd().Trim(); " +
  "$plain = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($in)); " +
  "ConvertTo-SecureString -String $plain -AsPlainText -Force | ConvertFrom-SecureString";
const UNPROTECT =
  "$ErrorActionPreference = 'Stop'; $in = [Console]::In.ReadToEnd().Trim(); " +
  "$secure = ConvertTo-SecureString -String $in; " +
  "$plain = (New-Object System.Management.Automation.PSCredential('x', $secure)).GetNetworkCredential().Password; " +
  "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($plain))";
const POWERSHELL_ARGS = ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"];

/**
 * Ambiente do PowerShell filho, sem o PSModulePath do pai. Quando o app sobe de um pwsh (PowerShell 7: terminal,
 * step do CI, tarefa criada por ele), o filho herda o caminho de modulos do 7 e o Windows PowerShell 5.1 encontra
 * o ConvertTo-SecureString la, mas nao consegue carregar o modulo: sai com codigo 1 e nada e cifrado. Sem a
 * variavel, o 5.1 monta o caminho padrao dele e os cmdlets da DPAPI carregam de onde sempre carregaram.
 */
function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "psmodulepath"));
}

/** `env` e o ambiente do processo que chama; o teste passa um ambiente montado, com o PSModulePath do PowerShell 7. */
export function createDpapiStore(processEnv: NodeJS.ProcessEnv = process.env, run: SecretCommand = runSecretCommand): SecretStore {
  const env = childEnv(processEnv);
  return {
    async protect(plain) {
      const blob = await run("powershell.exe", [...POWERSHELL_ARGS, PROTECT], toBase64(plain), env);
      if (!HEX.test(blob)) throw new Error("a DPAPI devolveu um formato inesperado");
      return blob;
    },
    async unprotect(blob) {
      if (!HEX.test(blob)) throw new Error("senha salva em formato inválido");
      return fromBase64(await run("powershell.exe", [...POWERSHELL_ARGS, UNPROTECT], blob, env));
    },
    async forget() {
      /* o texto cifrado mora no proprio banco */
    }
  };
}

/** Referencia `<prefixo><uuid>` gravada no banco pelos cofres que guardam o segredo fora dele. */
function referenceId(prefix: string, blob: string): string {
  const id = blob.startsWith(prefix) ? blob.slice(prefix.length) : "";
  if (!UUID.test(id)) throw new Error("senha salva em formato inválido");
  return id;
}

const KEYCHAIN_PREFIX = "keychain:";
const SECURITY = "/usr/bin/security";

/**
 * Keychain do macOS. `add-generic-password -w <senha>` poria a senha em argv, entao o comando vai pelo stdin do modo
 * interativo (`security -i`), e o valor gravado e o base64 da senha: o parser do modo interativo nunca ve aspas,
 * espaco ou barra. `keychain` e o arquivo de um keychain especifico (o teste usa um temporario); sem ele, o padrao
 * do usuario, que o login destrava.
 */
export function createKeychainStore({ keychain, run = runSecretCommand }: { keychain?: string; run?: SecretCommand } = {}): SecretStore {
  if (keychain !== undefined && !/^[^\s"'\\]+$/.test(keychain)) throw new Error("caminho de keychain com espaço ou aspas");
  const target = keychain ? [keychain] : [];

  async function read(id: string): Promise<string> {
    return fromBase64(await run(SECURITY, ["find-generic-password", "-a", id, "-s", SERVICE, "-w", ...target], ""));
  }

  return {
    async protect(plain) {
      const id = randomUUID();
      const command = ["add-generic-password", "-a", id, "-s", SERVICE, "-l", SERVICE, "-w", toBase64(plain), ...target].join(" ");
      await run(SECURITY, ["-i"], `${command}\n`);
      // O modo interativo pode sair com 0 mesmo quando o comando falha: so vale o que da para ler de volta.
      const stored = await read(id).catch(() => null);
      if (stored !== plain) throw new Error("o Keychain não guardou a senha");
      return `${KEYCHAIN_PREFIX}${id}`;
    },
    async unprotect(blob) {
      return read(referenceId(KEYCHAIN_PREFIX, blob));
    },
    async forget(blob) {
      await run(SECURITY, ["delete-generic-password", "-a", referenceId(KEYCHAIN_PREFIX, blob), "-s", SERVICE, ...target], "");
    }
  };
}

const SECRET_SERVICE_PREFIX = "secret-service:";

/**
 * Secret Service do Linux pelo `secret-tool` (pacote libsecret-tools). `store` le o valor do stdin. Sem o programa ou
 * sem um daemon de chaves na sessao (servidor sem desktop), o protect rejeita: o painel mostra o motivo e o .env
 * continua valendo.
 */
export function createSecretServiceStore({ run = runSecretCommand }: { run?: SecretCommand } = {}): SecretStore {
  const attributes = (id: string) => ["service", SERVICE, "account", id];

  async function read(id: string): Promise<string> {
    return fromBase64(await run("secret-tool", ["lookup", ...attributes(id)], ""));
  }

  return {
    async protect(plain) {
      const id = randomUUID();
      await run("secret-tool", ["store", `--label=${SERVICE}`, ...attributes(id)], toBase64(plain));
      const stored = await read(id).catch(() => null);
      if (stored !== plain) throw new Error("o Secret Service não guardou a senha");
      return `${SECRET_SERVICE_PREFIX}${id}`;
    },
    async unprotect(blob) {
      return read(referenceId(SECRET_SERVICE_PREFIX, blob));
    },
    async forget(blob) {
      await run("secret-tool", ["clear", ...attributes(referenceId(SECRET_SERVICE_PREFIX, blob))], "");
    }
  };
}

function createUnsupportedStore(): SecretStore {
  const unsupported = async (): Promise<never> => {
    throw new Error("este sistema não tem cofre de senha suportado");
  };
  return { protect: unsupported, unprotect: unsupported, forget: async () => undefined };
}

export function createSecretStore(platform: NodeJS.Platform = process.platform): SecretStore {
  if (platform === "win32") return createDpapiStore();
  if (platform === "darwin") return createKeychainStore();
  if (platform === "linux") return createSecretServiceStore();
  return createUnsupportedStore();
}

export const dpapiStore = createDpapiStore();
export const defaultSecretStore = createSecretStore();
