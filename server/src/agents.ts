// Agentes, modelos e efforts aceitos, copiados de dispatch-settings.ts do Syntax Ops.
// Claude Code: `--effort <low|medium|high|xhigh|max>`. Codex: `-c model_reasoning_effort=<minimal|low|medium|high>`.

export const AGENT_KINDS = ["CLAUDE", "CODEX"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

/** Quem executa a rotina: um dos agentes ou um script (comando direto, sem modelo). */
export const EXECUTOR_KINDS = ["CLAUDE", "CODEX", "SCRIPT"] as const;
export type ExecutorKind = (typeof EXECUTOR_KINDS)[number];

export function isAgentKind(kind: string): kind is AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(kind);
}

export const EFFORTS_BY_KIND: Record<AgentKind, readonly string[]> = {
  CLAUDE: ["low", "medium", "high", "xhigh", "max"],
  CODEX: ["minimal", "low", "medium", "high"]
};

export const MODELS_BY_KIND: Record<AgentKind, readonly { value: string; label: string }[]> = {
  CLAUDE: [
    { value: "claude-opus-5", label: "Opus 5" },
    { value: "claude-sonnet-5", label: "Sonnet 5" },
    { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" }
  ],
  CODEX: [
    { value: "gpt-5.6-sol", label: "SOL" },
    { value: "gpt-5.6-terra", label: "TERRA" },
    { value: "gpt-5.6-luna", label: "LUNA" }
  ]
};

export const TIMEOUT_OPTIONS_MINUTES = [15, 30, 60, 90, 120, 180, 240] as const;
export const TIMEOUT_DEFAULT_MINUTES = 60;
export const TIMEOUT_CEILING_MINUTES = 240;
/** Mesmo teto do Syntax Ops (`maxAttempts @default(3)`). */
export const MAX_ATTEMPTS = 3;

/** Intervalos aceitos em "a cada N minutos". Todos dividem 1440, entao a grade recomeça limpa a cada meia-noite. */
export const INTERVAL_OPTIONS_MINUTES = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720] as const;
/** Comando de uma rotina de script: uma linha, como seria digitada no cmd. */
export const COMMAND_MAX_CHARS = 2000;

export function otherAgent(kind: AgentKind): AgentKind {
  return kind === "CLAUDE" ? "CODEX" : "CLAUDE";
}

/** Effort que nao existe no agente (ex.: "max" ao cair do Claude para o Codex) vira "medium". */
export function normalizeEffort(kind: AgentKind, effort: string): string {
  return EFFORTS_BY_KIND[kind].includes(effort) ? effort : "medium";
}
