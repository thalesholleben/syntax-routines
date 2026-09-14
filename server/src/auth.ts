import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import type { RequestHandler, Response } from "express";

import type { Db } from "./db";
import { messages } from "./i18n";

export const SESSION_COOKIE = "sr_session";
export const MIN_PASSWORD_LENGTH = 8;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY = "password_hash";
const SCRYPT_KEY_LENGTH = 64;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 60_000;
// Porta do Vite em desenvolvimento; so entra na lista de origens com --dev.
const DEV_WEB_PORT = 5190;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64");
  const actual = scryptSync(password, Buffer.from(saltText, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function getPasswordHash(db: Db): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = :key").get({ key: PASSWORD_KEY }) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Cria a senha so se ainda nao existe. INSERT sem REPLACE: um setup concorrente bate na chave primaria. */
export function setupPassword(db: Db, password: string): boolean {
  try {
    db.prepare("INSERT INTO settings (key, value) VALUES (:key, :value)").run({ key: PASSWORD_KEY, value: hashPassword(password) });
    return true;
  } catch (error) {
    if (error instanceof Error && /constraint failed/i.test(error.message)) return false;
    throw error;
  }
}

export function changePassword(db: Db, password: string): void {
  db.prepare("UPDATE settings SET value = :value WHERE key = :key").run({ key: PASSWORD_KEY, value: hashPassword(password) });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sessao guardada so como hash: vazar o banco nao entrega um cookie valido. */
export function createSession(db: Db, nowMs: number): string {
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessions WHERE expires_at <= :now").run({ now: nowMs });
  db.prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (:tokenHash, :expiresAt)").run({
    tokenHash: hashToken(token),
    expiresAt: nowMs + SESSION_TTL_MS
  });
  return token;
}

export function isValidSession(db: Db, token: string | undefined, nowMs: number): boolean {
  if (!token) return false;
  const row = db
    .prepare(`SELECT expires_at AS "expiresAt" FROM sessions WHERE token_hash = :tokenHash`)
    .get({ tokenHash: hashToken(token) }) as { expiresAt: number } | undefined;
  return row !== undefined && row.expiresAt > nowMs;
}

export function deleteSession(db: Db, token: string | undefined): void {
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = :tokenHash").run({ tokenHash: hashToken(token) });
}

export function deleteOtherSessions(db: Db, keepToken: string | undefined): void {
  db.prepare("DELETE FROM sessions WHERE token_hash <> :tokenHash").run({ tokenHash: keepToken ? hashToken(keepToken) : "" });
}

export function readSessionToken(req: { headers: { cookie?: string } }): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name !== SESSION_COOKIE) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      // Cookie malformado (ex.: "%" solto) conta como sessao ausente, nunca como erro 500.
      return undefined;
    }
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: SESSION_TTL_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "strict", path: "/" });
}

export function createLoginLimiter(now: () => number) {
  let failures = 0;
  let lockedUntil = 0;
  return {
    retryAfterMs: (): number => Math.max(0, lockedUntil - now()),
    recordFailure: (): void => {
      failures += 1;
      if (failures >= LOGIN_MAX_FAILURES) {
        lockedUntil = now() + LOGIN_LOCK_MS;
        failures = 0;
      }
    },
    reset: (): void => {
      failures = 0;
      lockedUntil = 0;
    }
  };
}

/** So aceita o proprio endereco local. Barra DNS rebinding, inclusive no setup da senha. */
export const hostGuard: RequestHandler = (req, res, next) => {
  const port = req.socket.localPort;
  const host = (req.headers.host ?? "").toLowerCase();
  if (!port || (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)) {
    res.status(403).json({ message: messages(req.language).hostNotAllowed });
    return;
  }
  next();
};

/**
 * Origin presente e estranho: 403 em qualquer metodo. Metodo que altera estado exige Origin da lista, porque
 * outra pagina em 127.0.0.1 (outra porta) e "same-site" e o cookie SameSite=Strict iria junto.
 */
export function originGuard(isDev: boolean): RequestHandler {
  return (req, res, next) => {
    const port = req.socket.localPort;
    const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
    if (isDev) {
      allowed.add(`http://127.0.0.1:${DEV_WEB_PORT}`);
      allowed.add(`http://localhost:${DEV_WEB_PORT}`);
    }
    const origin = req.headers.origin;
    const isStateChanging = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    const isRejected = origin === undefined ? isStateChanging : !allowed.has(origin);
    if (isRejected) {
      res.status(403).json({ message: messages(req.language).originNotAllowed });
      return;
    }
    next();
  };
}

export function requireAuth(db: Db, now: () => number): RequestHandler {
  return (req, res, next) => {
    if (!isValidSession(db, readSessionToken(req), now())) {
      res.status(401).json({ message: messages(req.language).sessionExpired });
      return;
    }
    next();
  };
}
