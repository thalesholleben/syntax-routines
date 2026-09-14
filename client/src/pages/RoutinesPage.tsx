import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, FolderTree, History as HistoryIcon, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";

import { ProviderMark } from "../components/Logo";
import { PageHeader } from "../components/PageHeader";
import { RoutineModal } from "../components/RoutineModal";
import { RunOutputModal } from "../components/RunOutputModal";
import { Badge, Button, Card, ErrorBox, Skeleton } from "../components/ui";
import { apiRequest, formatApiError } from "../lib/api";
import { cn } from "../lib/cn";
import {
  AGENT_LABEL,
  basename,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatSchedule,
  RUN_STATUS_LABEL,
  RUN_STATUS_TONE
} from "../lib/format";
import type { AgentKind, ExecutorKind, RoutineDto, RunDto, SettingsResponse, StatusDto } from "../types";

const IDLE_POLL_MS = 5000;
const ACTIVE_POLL_MS = 2000;
const AGENT_TONE: Record<ExecutorKind, string> = { CLAUDE: "claude", CODEX: "codex", SCRIPT: "script" };

export function RoutinesPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [routines, setRoutines] = useState<RoutineDto[] | null>(null);
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [meta, setMeta] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ routine: RoutineDto | null } | null>(null);
  const [outputRunId, setOutputRunId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [routineData, statusData] = await Promise.all([
        apiRequest<{ routines: RoutineDto[] }>("/api/routines"),
        apiRequest<StatusDto>("/api/status")
      ]);
      setRoutines(routineData.routines);
      setStatus(statusData);
      setLoadError(null);
    } catch (error) {
      setLoadError(formatApiError(error));
    }
  }, []);

  const loadMeta = useCallback(() => {
    apiRequest<SettingsResponse>("/api/settings")
      .then(setMeta)
      .catch((error: unknown) => setLoadError(formatApiError(error)));
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  // Com execucao na fila ou rodando, atualiza mais rapido para o status aparecer sem recarregar.
  const hasActiveRun = routines?.some((routine) => routine.activeRun !== null) ?? false;
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), hasActiveRun ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [load, hasActiveRun]);

  async function act(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(formatApiError(error));
    }
    await load();
  }

  const nextRoutine = routines
    ?.filter((routine) => routine.nextRunAt !== null)
    .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0];
  const subtitle =
    routines === null
      ? "Carregando rotinas"
      : routines.length === 0
        ? "Nenhuma rotina ainda"
        : `${routines.length} ${routines.length === 1 ? "rotina" : "rotinas"}` +
          (nextRoutine?.nextRunAt ? ` · próxima: ${nextRoutine.name} ${formatRelative(nextRoutine.nextRunAt)}` : "");

  const limitNotices = status
    ? (["CLAUDE", "CODEX"] as AgentKind[])
        .filter((kind) => status.limits[kind].isOnLimit)
        .map((kind) => ({ kind, resetAt: status.limits[kind].resetAt }))
    : [];
  const hasRoot = Boolean(meta?.settings.rootDirectory);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Rotinas" subtitle={subtitle} />

      <div className="flex-1 overflow-y-auto p-3 pb-24 md:p-6 md:pb-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {/* A acao principal da tela, na largura dos cartoes, como o despacho do Ops. */}
          <button type="button" className="syntax-dispatch-cta" onClick={() => setEditing({ routine: null })} disabled={!meta}>
            <Plus className="size-5" aria-hidden="true" />
            Nova rotina
          </button>

          {limitNotices.map(({ kind, resetAt }) => (
            <div
              key={kind}
              role="status"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {AGENT_LABEL[kind]} está no limite de uso{resetAt ? ` até ${formatDateTime(Date.parse(resetAt))}` : ""}. Rotinas com
                troca automática rodam no outro agente; as demais esperam.
              </span>
            </div>
          ))}

          {actionError && <ErrorBox>{actionError}</ErrorBox>}
          {routines !== null && loadError && (
            <p role="status" className="text-xs text-[var(--color-warning)]">
              Não consegui atualizar agora ({loadError}). Mostrando o último estado.
            </p>
          )}

          {routines === null ? (
            loadError ? (
              <Card className="space-y-3 p-4">
                <ErrorBox>{loadError}</ErrorBox>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    loadMeta();
                    void load();
                  }}
                >
                  Tentar de novo
                </Button>
              </Card>
            ) : (
              <RoutineSkeletons />
            )
          ) : routines.length === 0 ? (
            <EmptyState hasRoot={hasRoot} onOpenSettings={onOpenSettings} />
          ) : (
            <div className="stagger space-y-3">
              {routines.map((routine) => (
                <div key={routine.id}>
                  <RoutineCard
                    routine={routine}
                    onRunNow={() => void act(() => apiRequest(`/api/routines/${routine.id}/run-now`, { method: "POST" }))}
                    onCancel={(runId) => void act(() => apiRequest(`/api/runs/${runId}/cancel`, { method: "POST" }))}
                    onEdit={() => setEditing({ routine })}
                    onDelete={() => {
                      if (window.confirm(`Excluir a rotina "${routine.name}"? O histórico dela também será apagado.`)) {
                        void act(() => apiRequest(`/api/routines/${routine.id}`, { method: "DELETE" }));
                      }
                    }}
                    onShowOutput={setOutputRunId}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {meta && (
        <RoutineModal
          open={editing !== null}
          routine={editing?.routine ?? null}
          agents={meta.agents}
          rootDirectory={meta.settings.rootDirectory}
          bootDelayMinutes={meta.settings.bootDelayMinutes}
          onSaved={() => void load()}
          onClose={() => setEditing(null)}
        />
      )}
      <RunOutputModal runId={outputRunId} onClose={() => setOutputRunId(null)} />
    </div>
  );
}

function RoutineSkeletons() {
  return (
    <div aria-busy="true" aria-label="Carregando rotinas" className="space-y-3">
      {[0, 1, 2].map((index) => (
        <Card key={index} className="space-y-3 p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-8" />
        </Card>
      ))}
    </div>
  );
}

function EmptyState({ hasRoot, onOpenSettings }: { hasRoot: boolean; onOpenSettings: () => void }) {
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
        <CalendarClock aria-hidden className="size-6" />
      </span>
      <h2 className="text-base font-semibold text-[var(--color-fg)]">Nenhuma rotina agendada</h2>
      <p className="max-w-sm text-sm text-[var(--color-fg-muted)]">
        {hasRoot
          ? "Crie a primeira no botão acima: agente, dias, hora e prompt. No horário marcado ela roda sozinha neste PC."
          : "Antes da primeira rotina, defina a pasta mãe em Ajustes. Os agentes só rodam dentro dela."}
      </p>
      {!hasRoot && <Button onClick={onOpenSettings}>Abrir Ajustes</Button>}
    </div>
  );
}

function RoutineCard({
  routine,
  onRunNow,
  onCancel,
  onEdit,
  onDelete,
  onShowOutput
}: {
  routine: RoutineDto;
  onRunNow: () => void;
  onCancel: (runId: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowOutput: (runId: number) => void;
}) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const { activeRun, lastRun } = routine;
  const isRunning = activeRun?.status === "RUNNING";

  return (
    <article
      aria-label={routine.name}
      data-harness={isRunning ? routine.agentKind : undefined}
      className={cn(
        "rounded-[var(--radius-lg)] border p-4",
        isRunning
          ? "syntax-live-job border-[var(--color-primary)]/40 bg-[var(--color-surface-2)]/70"
          : "glass card-hover border-[var(--color-border)]"
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ProviderMark kind={routine.agentKind} />
        <Badge tone={AGENT_TONE[routine.agentKind]}>{AGENT_LABEL[routine.agentKind]}</Badge>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-fg)]">{routine.name}</h2>
        {!routine.isEnabled && <Badge tone="muted">Pausada</Badge>}
        {activeRun && (
          <Badge tone={RUN_STATUS_TONE[activeRun.status]}>
            {isRunning && (
              <span aria-hidden className="pulse-dot">
                ●
              </span>
            )}
            {RUN_STATUS_LABEL[activeRun.status]}
          </Badge>
        )}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-fg-muted)]">
        <span className="inline-flex items-center gap-1">
          <CalendarClock aria-hidden className="size-3.5" />
          {formatSchedule(routine.days, routine.time, routine.intervalMinutes)}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1" title={routine.directory}>
          <FolderTree aria-hidden className="size-3.5 shrink-0" />
          <code className="truncate">{basename(routine.directory)}</code>
        </span>
      </p>

      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--color-fg-subtle)]">Próxima</dt>
          <dd className="tabular mt-0.5 text-[var(--color-fg)]">
            {routine.nextRunAt
              ? `${formatDateTime(routine.nextRunAt)} (${formatRelative(routine.nextRunAt)})`
              : routine.isEnabled
                ? "sem dia marcado"
                : "rotina pausada"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-fg-subtle)]">Última</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[var(--color-fg)]">
            {lastRun ? (
              <>
                <Badge tone={RUN_STATUS_TONE[lastRun.status]}>{RUN_STATUS_LABEL[lastRun.status]}</Badge>
                <span className="tabular">{formatDateTime(lastRun.finishedAt ?? lastRun.createdAt)}</span>
              </>
            ) : (
              "nunca rodou"
            )}
          </dd>
        </div>
      </dl>

      {isRunning && <div className="shimmer mt-3 h-1 w-full rounded-full bg-[var(--color-surface-3)]" />}
      {activeRun?.note && <p className="mt-2 text-xs text-[var(--color-fg-muted)]">{activeRun.note}</p>}
      {routine.directoryWarning && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-warning)]">
          <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          {routine.directoryWarning}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--color-border)] pt-3">
        {activeRun ? (
          <Button size="sm" variant="outline" onClick={() => onCancel(activeRun.id)}>
            <Square aria-hidden className="size-3.5" /> Cancelar execução
          </Button>
        ) : (
          <Button size="sm" onClick={onRunNow}>
            <Play aria-hidden className="size-3.5" /> Executar agora
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-expanded={isHistoryOpen} onClick={() => setIsHistoryOpen((current) => !current)}>
          <HistoryIcon aria-hidden className="size-3.5" /> Histórico
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil aria-hidden className="size-3.5" /> Editar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto hover:text-[var(--color-danger)]"
          onClick={onDelete}
          aria-label={`Excluir ${routine.name}`}
          title="Excluir rotina"
        >
          <Trash2 aria-hidden className="size-3.5" />
        </Button>
      </div>

      {isHistoryOpen && (
        <RunHistory
          routineId={routine.id}
          refreshKey={`${activeRun?.id ?? 0}-${activeRun?.status ?? ""}-${lastRun?.id ?? 0}-${lastRun?.status ?? ""}`}
          onShowOutput={onShowOutput}
        />
      )}
    </article>
  );
}

function RunHistory({ routineId, refreshKey, onShowOutput }: { routineId: number; refreshKey: string; onShowOutput: (runId: number) => void }) {
  const [runs, setRuns] = useState<RunDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isAlive = true;
    apiRequest<{ runs: RunDto[] }>(`/api/routines/${routineId}/runs?limit=20`)
      .then((data) => {
        if (!isAlive) return;
        setRuns(data.runs);
        setError(null);
      })
      .catch((err: unknown) => {
        if (isAlive) setError(formatApiError(err));
      });
    return () => {
      isAlive = false;
    };
  }, [routineId, refreshKey]);

  if (error) {
    return (
      <div className="mt-3">
        <ErrorBox>{error}</ErrorBox>
      </div>
    );
  }
  if (!runs) {
    return (
      <div aria-busy="true" className="mt-3 space-y-2">
        <Skeleton className="h-8" />
        <Skeleton className="h-8" />
      </div>
    );
  }
  if (runs.length === 0) {
    return <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">Esta rotina ainda não teve nenhuma execução.</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/50">
      {runs.map((run) => (
        <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
          <span className="text-[var(--color-fg-muted)]">{run.triggerType === "MANUAL" ? "Manual" : "Agendada"}</span>
          <span className="tabular text-[var(--color-fg)]">{formatDateTime(run.scheduledFor)}</span>
          {run.agentKind && <span className="text-[var(--color-fg-muted)]">{AGENT_LABEL[run.agentKind]}</span>}
          {run.startedAt && <span className="tabular text-[var(--color-fg-muted)]">{formatDuration(run.startedAt, run.finishedAt)}</span>}
          {run.status !== "SKIPPED" && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onShowOutput(run.id)}>
              Ver saída
            </Button>
          )}
          {run.note && <p className="w-full text-xs text-[var(--color-fg-subtle)]">{run.note}</p>}
        </li>
      ))}
    </ul>
  );
}
