// Senha do e-mail salva pelo painel: cifrada com a DPAPI do Windows no escopo do usuario. So o mesmo usuario, no
// mesmo PC, abre de volta; o banco copiado para outro lugar (backup, anexo de issue) nao revela a senha. Quem cifra
// e o Windows PowerShell do proprio sistema, e o segredo vai e volta so pelo stdin, em base64: nada em argv, nada
// em arquivo, e o texto de erro do PowerShell nao e repassado (ele cita o comando).
import { spawn } from "node:child_process";

export interface SecretStore {
  protect: (plain: string) => Promise<string>;
  unprotect: (blob: string) => Promise<string>;
}

const TIMEOUT_MS = 30_000;
const HEX = /^[0-9a-f]+$/i;

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

function runPowerShell(script: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let isSettled = false;
    const settle = (error: Error | null, value = "") => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const child = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      child.kill();
      settle(new Error("o PowerShell não respondeu a tempo"));
    }, TIMEOUT_MS);
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.resume();
    // Sem PowerShell (ou ele morrendo antes de ler), a escrita no stdin falha com EPIPE: vira rejeicao, nao crash.
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => settle(error));
    child.on("close", (code) => settle(code === 0 ? null : new Error(`o PowerShell saiu com código ${code}`), stdout.trim()));
    child.stdin.end(input);
  });
}

export const dpapiStore: SecretStore = {
  async protect(plain) {
    const blob = await runPowerShell(PROTECT, Buffer.from(plain, "utf8").toString("base64"));
    if (!HEX.test(blob)) throw new Error("a DPAPI devolveu um formato inesperado");
    return blob;
  },
  async unprotect(blob) {
    if (!HEX.test(blob)) throw new Error("senha salva em formato inválido");
    return Buffer.from(await runPowerShell(UNPROTECT, blob), "base64").toString("utf8");
  }
};
