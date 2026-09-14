import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { openDb } from "./db";
import { createRoutine } from "./routines";
import type { RunAgent } from "./runner";
import { startServer } from "./server";

let dataDir = "";

const fakeRunAgent: RunAgent = () => ({ done: new Promise(() => {}), kill: () => {} });

beforeEach(() => {
  dataDir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-server-")));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

function readRuns() {
  const db = openDb(path.join(dataDir, "app.db"));
  const runs = db.prepare(`SELECT status, error FROM runs ORDER BY id`).all();
  db.close();
  return runs;
}

it("porta ocupada rejeita sem tocar nas execucoes; com a porta livre recupera a orfa e sobe", async () => {
  const db = openDb(path.join(dataDir, "app.db"));
  const routineId = createRoutine(
    db,
    {
      name: "Rotina",
      agentKind: "CLAUDE",
      directory: dataDir,
      model: null,
      effort: "high",
      timeoutMinutes: 30,
      isFallbackEnabled: false,
      days: [1],
      time: "09:00",
      intervalMinutes: null,
      prompt: "oi",
      command: null,
      missedPolicy: "SKIP",
      isEnabled: true
    },
    Date.now()
  );
  db.prepare(
    `INSERT INTO runs (routine_id, trigger_type, scheduled_for, run_at, status, attempt, created_at) VALUES (?, 'MANUAL', 1, 1, 'RUNNING', 1, 1)`
  ).run(routineId);
  db.close();

  const blocker = net.createServer();
  await new Promise<void>((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const port = (blocker.address() as AddressInfo).port;

  await expect(startServer({ port, dataDir, runAgent: fakeRunAgent })).rejects.toMatchObject({ code: "EADDRINUSE" });
  expect(readRuns()).toEqual([{ status: "RUNNING", error: null }]);

  await new Promise<void>((resolve) => blocker.close(() => resolve()));
  const server = await startServer({ port, dataDir, runAgent: fakeRunAgent });
  try {
    expect(server.port).toBe(port);
    expect(readRuns()).toEqual([{ status: "FAILED", error: "Interrompida: o app foi encerrado durante a execução." }]);
  } finally {
    await server.close();
  }
});
