import { describe, expect, it } from "vitest";

import { normalizeEffort } from "./agents";
import { classifyError, decideRetry, parseLimitReset } from "./retry-policy";

const now = new Date(2026, 8, 14, 10, 0, 0);

describe("classifyError", () => {
  it("limite de uso", () => {
    expect(classifyError("Claude AI usage limit reached")).toBe("limit");
    expect(classifyError("429 Too Many Requests")).toBe("limit");
  });

  it("fatal", () => {
    expect(classifyError("Error: not authenticated")).toBe("fatal");
    expect(classifyError("'claud' is not recognized as an internal or external command")).toBe("fatal");
    expect(classifyError("'claud' não é reconhecido como um comando interno ou externo")).toBe("fatal");
  });

  it("transitorio", () => {
    expect(classifyError("CLAUDE encerrou com codigo 1.\nsocket hang up")).toBe("transient");
  });
});

describe("parseLimitReset", () => {
  it("horario no futuro fica no mesmo dia", () => {
    expect(parseLimitReset("usage limit reached, resets at 3pm", now)).toEqual(new Date(2026, 8, 14, 15, 0, 0));
  });

  it("horario que ja passou vai para o dia seguinte", () => {
    expect(parseLimitReset("limit reached, resets at 9am", now)).toEqual(new Date(2026, 8, 15, 9, 0, 0));
  });

  it("mensagem real do Codex com try again at", () => {
    const message =
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 7:45 AM.";
    const earlyMorning = new Date(2026, 8, 14, 4, 22, 0);
    expect(classifyError(message)).toBe("limit");
    expect(parseLimitReset(message, earlyMorning)).toEqual(new Date(2026, 8, 14, 7, 45, 0));
    expect(decideRetry({ text: message, attemptCount: 1, maxAttempts: 3, now: earlyMorning }).nextRetryAt).toEqual(
      new Date(2026, 8, 14, 7, 50, 0)
    );
  });

  it("relativo", () => {
    expect(parseLimitReset("try again in 2 hours", now)).toEqual(new Date(now.getTime() + 2 * 3_600_000));
  });

  it("ISO", () => {
    expect(parseLimitReset("resets at 2026-09-14T18:30:00Z", now)).toEqual(new Date("2026-09-14T18:30:00Z"));
  });

  it("epoch em segundos", () => {
    const future = Math.floor(now.getTime() / 1000) + 3600;
    expect(parseLimitReset(`reset ${future}`, now)).toEqual(new Date(future * 1000));
  });

  it("sem horario", () => {
    expect(parseLimitReset("usage limit reached", now)).toBeNull();
  });
});

describe("decideRetry", () => {
  it("limite reagenda para o reset + 5 min", () => {
    expect(decideRetry({ text: "usage limit reached, resets at 3pm", attemptCount: 1, maxAttempts: 3, now })).toMatchObject({
      status: "ERROR",
      reason: "limit",
      nextRetryAt: new Date(2026, 8, 14, 15, 5, 0),
      rawResetAt: new Date(2026, 8, 14, 15, 0, 0)
    });
  });

  it("limite sem horario espera 1 h", () => {
    expect(decideRetry({ text: "rate limit", attemptCount: 1, maxAttempts: 3, now }).nextRetryAt).toEqual(
      new Date(now.getTime() + 3_600_000)
    );
  });

  it("transitorio faz backoff dobrando", () => {
    expect(decideRetry({ text: "boom", attemptCount: 1, maxAttempts: 3, now }).nextRetryAt).toEqual(new Date(now.getTime() + 30_000));
    expect(decideRetry({ text: "boom", attemptCount: 2, maxAttempts: 3, now }).nextRetryAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it("esgota na terceira tentativa", () => {
    expect(decideRetry({ text: "usage limit reached", attemptCount: 3, maxAttempts: 3, now }).status).toBe("FAILED");
  });

  it("fatal falha na primeira", () => {
    expect(decideRetry({ text: "spawn claude ENOENT", attemptCount: 1, maxAttempts: 3, now })).toMatchObject({
      status: "FAILED",
      reason: "fatal"
    });
  });
});

describe("normalizeEffort", () => {
  it("mantem effort valido e troca o invalido por medium", () => {
    expect(normalizeEffort("CODEX", "high")).toBe("high");
    expect(normalizeEffort("CODEX", "max")).toBe("medium");
    expect(normalizeEffort("CLAUDE", "minimal")).toBe("medium");
  });
});
