import http from "node:http";
import path from "node:path";

import { createApp } from "./app";
import { openDb } from "./db";
import { log, setLogFile } from "./log";
import { createMailer, type Mailer } from "./mailer";
import { runAgent as realRunAgent, runScript as realRunScript, type RunAgent, type RunScript } from "./runner";
import { createScheduler } from "./scheduler";

export interface ServerOptions {
  port: number;
  dataDir: string;
  clientDir?: string;
  isDev?: boolean;
  now?: () => number;
  runAgent?: RunAgent;
  runScript?: RunScript;
  mailer?: Mailer;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

/**
 * Escuta a porta ANTES de mexer nas execucoes: com a porta ocupada (outra instancia rodando) rejeita sem
 * recuperar nem agendar nada. Abrir o banco e criar tabelas inexistentes nao altera linhas.
 */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const now = options.now ?? Date.now;
  setLogFile(path.join(options.dataDir, "app.log"));
  const db = openDb(path.join(options.dataDir, "app.db"));
  const logsDir = path.join(options.dataDir, "logs");
  const mailer = options.mailer ?? createMailer(process.env);
  const panelUrl = `http://127.0.0.1:${options.port}/`;
  const scheduler = createScheduler({
    db,
    runAgent: options.runAgent ?? realRunAgent,
    runScript: options.runScript ?? realRunScript,
    logsDir,
    now,
    mailer,
    panelUrl
  });
  const server = http.createServer(
    createApp({ db, scheduler, logsDir, mailer, panelUrl, clientDir: options.clientDir, isDev: options.isDev, now })
  );

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    db.close();
    log(`não foi possível escutar 127.0.0.1:${options.port}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }

  const recovered = scheduler.recoverOnBoot();
  if (recovered > 0) log(`${recovered} execução(ões) interrompida(s) na última sessão marcada(s) como falha`);
  scheduler.start();

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port;
  log(`Syntax Routines em http://127.0.0.1:${port}`);

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        scheduler.stop();
        server.close(() => {
          db.close();
          resolve();
        });
        server.closeAllConnections();
      })
  };
}
