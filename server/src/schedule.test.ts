import { describe, expect, it } from "vitest";

import { GRACE_MS, nextOccurrence, occurrencesBetween, planWindow } from "./schedule";

// Setembro de 2026 em horario local: o dia 14 e segunda-feira (getDay 1).
const at = (day: number, hours: number, minutes = 0, seconds = 0) => new Date(2026, 8, day, hours, minutes, seconds).getTime();
const MIN = 60_000;
const mondayAt9 = { days: [1], time: "09:00" };

describe("occurrencesBetween", () => {
  it("acha a ocorrencia dentro da janela", () => {
    expect(occurrencesBetween(mondayAt9, at(14, 8), at(14, 10))).toEqual([at(14, 9)]);
  });

  it("janela semiaberta: o inicio fica fora e o fim fica dentro", () => {
    expect(occurrencesBetween(mondayAt9, at(14, 9), at(14, 10))).toEqual([]);
    expect(occurrencesBetween(mondayAt9, at(14, 8), at(14, 9))).toEqual([at(14, 9)]);
  });

  it("janela vazia ou invertida nao gera nada", () => {
    expect(occurrencesBetween(mondayAt9, at(14, 10), at(14, 10))).toEqual([]);
    expect(occurrencesBetween(mondayAt9, at(14, 10), at(14, 8))).toEqual([]);
  });

  it("ignora dias nao marcados", () => {
    expect(occurrencesBetween({ days: [2], time: "09:00" }, at(14, 0), at(14, 23))).toEqual([]);
  });

  it("vira o dia", () => {
    expect(occurrencesBetween({ days: [0, 1, 2, 3, 4, 5, 6], time: "00:30" }, at(14, 23), at(15, 1))).toEqual([at(15, 0, 30)]);
  });

  it("janela de varios dias traz todas em ordem", () => {
    // domingo 13 ao domingo 20: segunda 14, quarta 16 e sexta 18
    expect(occurrencesBetween({ days: [5, 1, 3], time: "09:00" }, at(13, 12), at(20, 12))).toEqual([
      at(14, 9),
      at(16, 9),
      at(18, 9)
    ]);
  });
});

describe("occurrencesBetween por intervalo", () => {
  const every15 = { days: [0, 1, 2, 3, 4, 5, 6], time: "09:00", intervalMinutes: 15 };

  it("grade alinhada a meia-noite, so dentro da janela", () => {
    expect(occurrencesBetween(every15, at(14, 13, 7), at(14, 13, 47))).toEqual([at(14, 13, 15), at(14, 13, 30), at(14, 13, 45)]);
  });

  it("ignora a hora fixa quando ha intervalo", () => {
    expect(occurrencesBetween({ ...every15, intervalMinutes: 60 }, at(14, 8, 30), at(14, 9, 30))).toEqual([at(14, 9)]);
    expect(occurrencesBetween({ ...every15, time: "09:07", intervalMinutes: 60 }, at(14, 8, 30), at(14, 9, 30))).toEqual([at(14, 9)]);
  });

  it("vira a meia-noite respeitando o dia marcado", () => {
    // segunda 14 -> terca 15; so terca marcada: nada de segunda 23:45, entra terca 00:00 e 00:15
    expect(occurrencesBetween({ days: [2], time: "00:00", intervalMinutes: 15 }, at(14, 23, 40), at(15, 0, 20))).toEqual([
      at(15, 0),
      at(15, 0, 15)
    ]);
  });

  it("nao gera ocorrencia em dia nao marcado", () => {
    // sabado 19 fora; domingo 20 fora
    expect(occurrencesBetween({ days: [1, 2, 3, 4, 5], time: "00:00", intervalMinutes: 60 }, at(19, 0), at(20, 23))).toEqual([]);
  });

  it("intervalo de 12 h", () => {
    expect(occurrencesBetween({ ...every15, intervalMinutes: 720 }, at(14, 0), at(15, 0))).toEqual([at(14, 12), at(15, 0)]);
  });
});

describe("nextOccurrence por intervalo", () => {
  it("proximo slot do dia", () => {
    expect(nextOccurrence({ days: [1], time: "09:00", intervalMinutes: 15 }, at(14, 13, 7))).toBe(at(14, 13, 15));
    expect(nextOccurrence({ days: [1], time: "09:00", intervalMinutes: 15 }, at(14, 13, 15))).toBe(at(14, 13, 30));
  });

  it("ultimo slot do dia leva ao proximo dia marcado", () => {
    expect(nextOccurrence({ days: [1, 3], time: "09:00", intervalMinutes: 60 }, at(14, 23, 30))).toBe(at(16, 0));
  });

  it("sem dias marcados", () => {
    expect(nextOccurrence({ days: [], time: "09:00", intervalMinutes: 15 }, at(14, 8))).toBeNull();
  });
});

describe("planWindow por intervalo", () => {
  const delay = 10 * MIN;
  const isInterval = { isInterval: true };

  it("no horario roda ja, e as anteriores nem viram linha", () => {
    expect(planWindow([at(14, 13), at(14, 13, 15), at(14, 13, 30)], at(14, 13, 30, 20), "RUN_ON_BOOT", delay, GRACE_MS, isInterval)).toEqual([
      { scheduledFor: at(14, 13, 30), status: "QUEUED", runAt: at(14, 13, 30), note: null }
    ]);
  });

  it("atrasada alem da tolerancia e descartada, com qualquer politica", () => {
    expect(planWindow([at(14, 13), at(14, 13, 15)], at(14, 13, 15) + GRACE_MS + 1, "RUN_ON_BOOT", delay, GRACE_MS, isInterval)).toEqual([]);
    expect(planWindow([at(14, 13, 15)], at(14, 13, 15) + GRACE_MS + 1, "SKIP", delay, GRACE_MS, isInterval)).toEqual([]);
  });
});

describe("planWindow", () => {
  const delay = 10 * MIN;

  it("no horario roda ja", () => {
    expect(planWindow([at(14, 9)], at(14, 9, 0, 10), "SKIP", delay)).toEqual([
      { scheduledFor: at(14, 9), status: "QUEUED", runAt: at(14, 9), note: null }
    ]);
  });

  it("atraso de exatamente 2 min ainda conta como no horario", () => {
    expect(planWindow([at(14, 9)], at(14, 9) + GRACE_MS, "SKIP", delay)[0].status).toBe("QUEUED");
  });

  it("SKIP pula a ocorrencia atrasada", () => {
    expect(planWindow([at(14, 9)], at(14, 9) + GRACE_MS + 1, "SKIP", delay)).toEqual([
      { scheduledFor: at(14, 9), status: "SKIPPED", runAt: null, note: "PC desligado ou app fechado no horário." }
    ]);
  });

  it("RUN_ON_BOOT agenda para agora + atraso", () => {
    const now = at(14, 11);
    expect(planWindow([at(14, 9)], now, "RUN_ON_BOOT", delay)[0]).toMatchObject({
      scheduledFor: at(14, 9),
      status: "QUEUED",
      runAt: now + delay
    });
  });

  it("varias perdidas: so a mais recente segue a politica", () => {
    const now = at(17, 12);
    const plans = planWindow([at(15, 9), at(14, 9), at(16, 9)], now, "RUN_ON_BOOT", delay);
    expect(plans.map((plan) => [plan.scheduledFor, plan.status, plan.runAt])).toEqual([
      [at(14, 9), "SKIPPED", null],
      [at(15, 9), "SKIPPED", null],
      [at(16, 9), "QUEUED", now + delay]
    ]);
  });

  it("perdidas antigas + mais recente no horario: antigas puladas e a recente roda ja", () => {
    const plans = planWindow([at(13, 9), at(14, 9)], at(14, 9, 1), "RUN_ON_BOOT", delay);
    expect(plans.map((plan) => [plan.status, plan.runAt])).toEqual([
      ["SKIPPED", null],
      ["QUEUED", at(14, 9)]
    ]);
  });

  it("sem ocorrencias nao planeja nada", () => {
    expect(planWindow([], at(14, 9), "SKIP", delay)).toEqual([]);
  });
});

describe("nextOccurrence", () => {
  it("mesmo dia antes do horario", () => {
    expect(nextOccurrence(mondayAt9, at(14, 8))).toBe(at(14, 9));
  });

  it("exatamente no horario ou depois vai para a semana seguinte", () => {
    expect(nextOccurrence(mondayAt9, at(14, 9))).toBe(at(21, 9));
    expect(nextOccurrence(mondayAt9, at(14, 10))).toBe(at(21, 9));
  });

  it("proximo dia marcado", () => {
    expect(nextOccurrence({ days: [3], time: "07:15" }, at(14, 10))).toBe(at(16, 7, 15));
  });

  it("sem dias marcados", () => {
    expect(nextOccurrence({ days: [], time: "09:00" }, at(14, 8))).toBeNull();
  });
});
