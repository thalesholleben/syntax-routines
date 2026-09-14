import path from "node:path";

import { log } from "./log";
import { startServer } from "./server";

// Mesma profundidade em dev (server/src) e no build (dist/server): dois niveis acima e a raiz do projeto.
const projectDir = path.resolve(import.meta.dirname, "../..");
const port = Number(process.env.PORT ?? 4090);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(projectDir, "data");

// SMTP do aviso por e-mail (SMTP_*, MAIL_FROM_*) vem do .env da raiz; sem o arquivo o app sobe sem e-mail.
// Variavel que ja veio do ambiente tem prioridade e loadEnvFile nao apaga nada que exista.
const envFile = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.join(projectDir, ".env");
try {
  process.loadEnvFile(envFile);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") log(`.env não carregado: ${error instanceof Error ? error.message : String(error)}`);
}

if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  console.error(`PORT inválida: ${process.env.PORT}`);
  process.exit(1);
}

try {
  const server = await startServer({
    port,
    dataDir,
    clientDir: path.join(projectDir, "dist", "client"),
    isDev: process.argv.includes("--dev")
  });
  const shutdown = () => {
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} catch (error) {
  log(`encerrando: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
