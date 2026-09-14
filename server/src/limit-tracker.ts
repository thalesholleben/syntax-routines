// Rastreia em memoria quando cada agente atingiu limite de uso e quando volta.
// Copia de tool-limit-tracker.ts do Syntax Ops, com relogio injetavel para teste.
// Reiniciar o app zera o estado; a proxima falha por limite registra de novo.

import type { AgentKind } from "./agents";

const DEFAULT_LIMIT_MS = 60 * 60 * 1000;

export class LimitTracker {
  private readonly limits = new Map<AgentKind, number>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  recordLimit(kind: AgentKind, resetAt: Date | null): void {
    this.limits.set(kind, resetAt ? resetAt.getTime() : this.now() + DEFAULT_LIMIT_MS);
  }

  clearLimit(kind: AgentKind): void {
    this.limits.delete(kind);
  }

  isOnLimit(kind: AgentKind): boolean {
    const resetAt = this.limits.get(kind);
    if (resetAt === undefined) return false;
    if (resetAt <= this.now()) {
      this.limits.delete(kind);
      return false;
    }
    return true;
  }

  getResetAt(kind: AgentKind): Date | null {
    return this.isOnLimit(kind) ? new Date(this.limits.get(kind) as number) : null;
  }

  getStatus(): Record<AgentKind, { isOnLimit: boolean; resetAt: string | null }> {
    const view = (kind: AgentKind) => ({ isOnLimit: this.isOnLimit(kind), resetAt: this.getResetAt(kind)?.toISOString() ?? null });
    return { CLAUDE: view("CLAUDE"), CODEX: view("CODEX") };
  }
}
