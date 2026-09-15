import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { AlertTriangle, CalendarClock, FolderTree, History as HistoryIcon, Pencil, Play, Plus, Search, Square, Trash2 } from "lucide-react";

import { ProviderMark } from "../components/Logo";
import { PageHeader } from "../components/PageHeader";
import { RoutineModal } from "../components/RoutineModal";
import { RunOutputModal } from "../components/RunOutputModal";
import { Badge, Button, Card, ErrorBox, Skeleton } from "../components/ui";
import { useI18n } from "../i18n";
import { apiRequest, formatApiError } from "../lib/api";
import { cn } from "../lib/cn";
import { basename, RUN_STATUS_TONE, useFormat } from "../lib/format";
import type { AgentKind, ExecutorKind, RoutineDto, RunDto, SettingsResponse, StatusDto } from "../types";

const IDLE_POLL_MS = 5000;
const ACTIVE_POLL_MS = 2000;
const AGENT_TONE: Record<ExecutorKind, string> = { CLAUDE: "claude", CODEX: "codex", SCRIPT: "script" };
const KIND_OPTIONS: ExecutorKind[] = ["CLAUDE", "CODEX", "SCRIPT"];

type KindFilter = ExecutorKind | "";

/** Busca sem acento nem caixa: "instagram" acha "Instagram SyntaxLab: fila", "conferencia" acha "Conferência". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function matchesFilter(
  routine: Pick<RoutineDto, "name" | "agentKind" | "directory">,
  query: string,
  kind: KindFilter,
  directory = ""
): boolean {
  if (kind && routine.agentKind !== kind) return false;
  if (directory && routine.directory !== directory) return false;
  const needle = fold(query.trim());
  return needle === "" || fold(routine.name).includes(needle);
}

export function RoutinesPage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { m, language } = useI18n();
  const f = useFormat();
  const [routines, setRoutines] = useState<RoutineDto[] | null>(null);
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [meta, setMeta] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ routine: RoutineDto | null } | null>(null);
  const [outputRunId, setOutputRunId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("");
  const [directory, setDirectory] = useState("");

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
  // Trocar o idioma tambem recarrega: o aviso de diretorio vem do servidor no idioma do painel.
  const hasActiveRun = routines?.some((routine) => routine.activeRun !== null) ?? false;
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), hasActiveRun ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [load, hasActiveRun, language]);

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
      ? m.loadingRoutines
      : routines.length === 0
        ? m.noRoutinesYet
        : m.routineCount(routines.length) + (nextRoutine?.nextRunAt ? m.nextIs(nextRoutine.name, f.formatRelative(nextRoutine.nextRunAt)) : "");

  const limitNotices = status
    ? (["CLAUDE", "CODEX"] as AgentKind[])
        .filter((kind) => status.limits[kind].isOnLimit)
        .map((kind) => ({ kind, resetAt: status.limits[kind].resetAt }))
    : [];
  const hasRoot = Boolean(meta?.settings.rootDirectory);

  // O filtro so muda o que aparece: contagem do subtitulo, polling e proxima execucao seguem olhando todas.
  // Pasta que sumiu da lista (rotina apagada ou movida) deixa de filtrar, em vez de esconder tudo.
  const directories = directoryOptions(routines ?? [], meta?.settings.rootDirectory ?? "");
  const activeDirectory = directories.some((option) => option.value === directory) ? directory : "";
  const isFiltering = query.trim() !== "" || kind !== "" || activeDirectory !== "";
  const visible = routines?.filter((routine) => matchesFilter(routine, query, kind, activeDirectory)) ?? [];
  function clearFilter() {
    setQuery("");
    setKind("");
    setDirectory("");
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={m.navRoutines}
        subtitle={subtitle}
        actions={
          routines !== null && routines.length > 0 ? (
            <RoutineFilter
              query={query}
              kind={kind}
              directory={activeDirectory}
              directories={directories}
              onQuery={setQuery}
              onKind={setKind}
              onDirectory={setDirectory}
            />
          ) : undefined
        }
      />

      <div className="flex-1 overflow-y-auto p-3 pb-24 md:p-6 md:pb-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {/* A acao principal da tela, na largura dos cartoes, como o despacho do Ops. */}
          <button type="button" className="syntax-dispatch-cta" onClick={() => setEditing({ routine: null })} disabled={!meta}>
            <Plus className="size-5" aria-hidden="true" />
            {m.newRoutine}
          </button>

          {limitNotices.map(({ kind, resetAt }) => (
            <div
              key={kind}
              role="status"
              className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-3 text-xs text-[var(--color-warning)]"
            >
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{m.limitNotice(f.agentLabel[kind], resetAt ? m.limitUntil(f.formatDateTime(Date.parse(resetAt))) : "")}</span>
            </div>
          ))}

          {actionError && <ErrorBox>{actionError}</ErrorBox>}
          {routines !== null && loadError && (
            <p role="status" className="text-xs text-[var(--color-warning)]">
              {m.staleData(loadError)}
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
                  {m.retry}
                </Button>
              </Card>
            ) : (
              <RoutineSkeletons label={m.loadingRoutines} />
            )
          ) : routines.length === 0 ? (
            <EmptyState hasRoot={hasRoot} onOpenSettings={onOpenSettings} />
          ) : (
            <div className="stagger space-y-3">
              {isFiltering && (
                <p role="status" className="flex items-center justify-between gap-2 px-1 text-xs text-[var(--color-fg-subtle)]">
                  <span>{m.filterCount(visible.length, routines.length)}</span>
                  <Button size="sm" variant="ghost" onClick={clearFilter}>
                    {m.clearFilter}
                  </Button>
                </p>
              )}
              {visible.map((routine) => (
                <div key={routine.id}>
                  <RoutineCard
                    routine={routine}
                    onRunNow={() => void act(() => apiRequest(`/api/routines/${routine.id}/run-now`, { method: "POST" }))}
                    onCancel={(runId) => void act(() => apiRequest(`/api/runs/${runId}/cancel`, { method: "POST" }))}
                    onEdit={() => setEditing({ routine })}
                    onDelete={() => {
                      if (window.confirm(m.confirmDelete(routine.name))) {
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

type DirectoryOption = { value: string; label: string };

/** Pastas das rotinas, pelo caminho a partir da pasta mae ("03-ferramentas/backlog"); fora dela, o caminho inteiro. */
export function directoryOptions(routines: Pick<RoutineDto, "directory">[], rootDirectory: string): DirectoryOption[] {
  const root = rootDirectory.replace(/[\\/]+$/, "");
  return [...new Set(routines.map((routine) => routine.directory))]
    .map((value) => {
      const isInsideRoot = root !== "" && value.toLowerCase().startsWith(`${root.toLowerCase()}\\`);
      const relative = isInsideRoot ? value.slice(root.length + 1).replace(/\\/g, "/") : value === root ? basename(value) : value;
      return { value, label: relative };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Busca por nome, tipo e pasta, no canto do cabecalho: discreto, some quando nao ha rotina para filtrar. */
function RoutineFilter({
  query,
  kind,
  directory,
  directories,
  onQuery,
  onKind,
  onDirectory
}: {
  query: string;
  kind: KindFilter;
  directory: string;
  directories: DirectoryOption[];
  onQuery: (value: string) => void;
  onKind: (value: KindFilter) => void;
  onDirectory: (value: string) => void;
}) {
  const { m } = useI18n();
  const f = useFormat();
  const field =
    "h-8 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)]/70 text-xs text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <label className="relative">
        <span className="sr-only">{m.searchRoutines}</span>
        <Search aria-hidden className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--color-fg-subtle)]" />
        <input
          type="search"
          value={query}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onQuery(event.target.value)}
          placeholder={m.searchPlaceholder}
          className={cn(field, "w-36 pl-7 pr-2 placeholder:text-[var(--color-fg-subtle)] sm:w-44")}
        />
      </label>
      <select
        aria-label={m.filterByType}
        value={kind}
        onChange={(event: ChangeEvent<HTMLSelectElement>) => onKind(event.target.value as KindFilter)}
        className={cn(field, "px-2", kind === "" && "text-[var(--color-fg-muted)]")}
      >
        <option value="">{m.allTypes}</option>
        {KIND_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {f.agentLabel[option]}
          </option>
        ))}
      </select>
      {/* Com uma pasta so, o seletor nao filtraria nada. */}
      {directories.length > 1 && (
        <select
          aria-label={m.filterByDirectory}
          value={directory}
          onChange={(event: ChangeEvent<HTMLSelectElement>) => onDirectory(event.target.value)}
          title={directory || undefined}
          className={cn(field, "max-w-44 px-2", directory === "" && "text-[var(--color-fg-muted)]")}
        >
          <option value="">{m.allDirectories}</option>
          {directories.map((option) => (
            <option key={option.value} value={option.value} title={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function RoutineSkeletons({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="space-y-3">
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
  const { m } = useI18n();
  return (
    <div className="glass flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-[var(--color-primary)]">
        <CalendarClock aria-hidden className="size-6" />
      </span>
      <h2 className="text-base font-semibold text-[var(--color-fg)]">{m.emptyTitle}</h2>
      <p className="max-w-sm text-sm text-[var(--color-fg-muted)]">{hasRoot ? m.emptyWithRoot : m.emptyWithoutRoot}</p>
      {!hasRoot && <Button onClick={onOpenSettings}>{m.openSettings}</Button>}
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
  const { m } = useI18n();
  const f = useFormat();
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
        <Badge tone={AGENT_TONE[routine.agentKind]}>{f.agentLabel[routine.agentKind]}</Badge>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-fg)]">{routine.name}</h2>
        {!routine.isEnabled && <Badge tone="muted">{m.paused}</Badge>}
        {activeRun && (
          <Badge tone={RUN_STATUS_TONE[activeRun.status]}>
            {isRunning && (
              <span aria-hidden className="pulse-dot">
                ●
              </span>
            )}
            {f.runStatusLabel[activeRun.status]}
          </Badge>
        )}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-fg-muted)]">
        <span className="inline-flex items-center gap-1">
          <CalendarClock aria-hidden className="size-3.5" />
          {f.formatSchedule(routine.days, routine.time, routine.intervalMinutes)}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1" title={routine.directory}>
          <FolderTree aria-hidden className="size-3.5 shrink-0" />
          <code className="truncate">{basename(routine.directory)}</code>
        </span>
      </p>

      <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-[var(--color-fg-subtle)]">{m.next}</dt>
          <dd className="tabular mt-0.5 text-[var(--color-fg)]">
            {routine.nextRunAt
              ? `${f.formatDateTime(routine.nextRunAt)} (${f.formatRelative(routine.nextRunAt)})`
              : routine.isEnabled
                ? m.noDayMarked
                : m.routinePaused}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-fg-subtle)]">{m.last}</dt>
          <dd className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[var(--color-fg)]">
            {lastRun ? (
              <>
                <Badge tone={RUN_STATUS_TONE[lastRun.status]}>{f.runStatusLabel[lastRun.status]}</Badge>
                <span className="tabular">{f.formatDateTime(lastRun.finishedAt ?? lastRun.createdAt)}</span>
              </>
            ) : (
              m.neverRan
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
            <Square aria-hidden className="size-3.5" /> {m.cancelRun}
          </Button>
        ) : (
          <Button size="sm" onClick={onRunNow}>
            <Play aria-hidden className="size-3.5" /> {m.runNow}
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-expanded={isHistoryOpen} onClick={() => setIsHistoryOpen((current) => !current)}>
          <HistoryIcon aria-hidden className="size-3.5" /> {m.history}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil aria-hidden className="size-3.5" /> {m.edit}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto hover:text-[var(--color-danger)]"
          onClick={onDelete}
          aria-label={m.deleteNamed(routine.name)}
          title={m.deleteRoutine}
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
  const { m } = useI18n();
  const f = useFormat();
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
    return <p className="mt-3 text-xs text-[var(--color-fg-subtle)]">{m.noRunsYet}</p>;
  }
  return (
    <ul className="mt-3 divide-y divide-[var(--color-border)] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]/50">
      {runs.map((run) => (
        <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
          <Badge tone={RUN_STATUS_TONE[run.status]}>{f.runStatusLabel[run.status]}</Badge>
          <span className="text-[var(--color-fg-muted)]">{run.triggerType === "MANUAL" ? m.manual : m.scheduled}</span>
          <span className="tabular text-[var(--color-fg)]">{f.formatDateTime(run.scheduledFor)}</span>
          {run.agentKind && <span className="text-[var(--color-fg-muted)]">{f.agentLabel[run.agentKind]}</span>}
          {run.startedAt && <span className="tabular text-[var(--color-fg-muted)]">{f.formatDuration(run.startedAt, run.finishedAt)}</span>}
          {run.status !== "SKIPPED" && (
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onShowOutput(run.id)}>
              {m.viewOutput}
            </Button>
          )}
          {run.note && <p className="w-full text-xs text-[var(--color-fg-subtle)]">{run.note}</p>}
        </li>
      ))}
    </ul>
  );
}
