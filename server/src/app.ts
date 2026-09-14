import { existsSync } from "node:fs";
import path from "node:path";

import express, { type ErrorRequestHandler, type RequestHandler } from "express";

import { hostGuard, originGuard, requireAuth } from "./auth";
import type { Db } from "./db";
import { languageFromHeader, messages } from "./i18n";
import { log } from "./log";
import { MailError, type MailService } from "./mailer";
import { ConflictError, NotFoundError } from "./routines";
import { createProtectedRouter, createPublicRouter, ValidationError } from "./routes";
import type { Scheduler } from "./scheduler";

export interface AppDeps {
  db: Db;
  scheduler: Scheduler;
  logsDir: string;
  mailer: MailService;
  panelUrl: string;
  clientDir?: string;
  isDev?: boolean;
  now?: () => number;
}

// A pagina dispara agente com acesso total: nada de iframe (clickjacking) nem sniffing de tipo.
const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  );
  next();
};

const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ValidationError) {
    res.status(400).json({ message: error.localized(req.language), details: error.details });
    return;
  }
  if (error instanceof NotFoundError) {
    res.status(404).json({ message: error.localized(req.language) });
    return;
  }
  if (error instanceof ConflictError) {
    res.status(409).json({ message: error.localized(req.language) });
    return;
  }
  // Falha do servidor SMTP (teste ou conta nova): 502, com o motivo para a tela dizer o que conferir.
  if (error instanceof MailError) {
    res.status(502).json({ message: error.localized(req.language), reason: error.reason });
    return;
  }
  // Erros do body parser (JSON quebrado, corpo grande) trazem status 4xx proprio.
  const status = typeof error?.status === "number" && error.status >= 400 && error.status < 500 ? error.status : 500;
  if (status === 500) log(`[api] erro inesperado: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  res.status(status).json({ message: status === 500 ? messages(req.language).internalError : messages(req.language).badRequest });
};

export function createApp({ db, scheduler, logsDir, mailer, panelUrl, clientDir, isDev = false, now = Date.now }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.use(securityHeaders);

  app.use("/api", (req, _res, next) => {
    req.language = languageFromHeader(req.headers["accept-language"]);
    next();
  });
  app.use("/api", hostGuard);
  app.use("/api", express.json({ limit: "1mb" }));
  app.use("/api", originGuard(isDev));
  app.use("/api/auth", createPublicRouter({ db, now }));
  app.use("/api", requireAuth(db, now)); // daqui para baixo tudo exige sessao
  app.use("/api", createProtectedRouter({ db, scheduler, logsDir, mailer, panelUrl, now }));
  app.use("/api", (req, res) => {
    res.status(404).json({ message: messages(req.language).routeNotFound });
  });

  if (clientDir && existsSync(path.join(clientDir, "index.html"))) {
    const indexHtml = path.join(clientDir, "index.html");
    app.use(express.static(clientDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET") {
        next();
        return;
      }
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
