import { useEffect, useState } from "react";

import { apiRequest, formatApiError } from "../lib/api";
import { AGENT_LABEL, formatDateTime, formatDuration, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "../lib/format";
import type { RunDto } from "../types";
import { Badge, Button, ErrorBox, Modal, Skeleton } from "./ui";

interface RunDetail {
  run: RunDto;
  log: string;
  logFile: string;
  logSize: number;
  isLogTruncated: boolean;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function RunOutputModal({ runId, onClose }: { runId: number | null; onClose: () => void }) {
  const [data, setData] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLogOpen, setIsLogOpen] = useState(false);

  useEffect(() => {
    if (runId === null) return;
    setData(null);
    setError(null);
    setIsLogOpen(false);
    let isAlive = true;
    apiRequest<RunDetail>(`/api/runs/${runId}`)
      .then((response) => {
        if (isAlive) setData(response);
      })
      .catch((err: unknown) => {
        if (isAlive) setError(formatApiError(err));
      });
    return () => {
      isAlive = false;
    };
  }, [runId]);

  const run = data?.run;

  return (
    <Modal open={runId !== null} onClose={onClose} title={`Execução #${runId ?? ""}`} wide>
      {error ? (
        <ErrorBox>{error}</ErrorBox>
      ) : !run || !data ? (
        <div aria-busy="true" className="space-y-3">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-10" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={RUN_STATUS_TONE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
            <Badge tone="muted">{run.triggerType === "MANUAL" ? "Manual" : "Agendada"}</Badge>
            {run.agentKind && <Badge tone="info">{AGENT_LABEL[run.agentKind]}</Badge>}
            {run.attempt > 0 && <Badge tone="muted">tentativa {run.attempt}</Badge>}
          </div>

          <dl className="grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Previsto</dt>
              <dd className="tabular mt-0.5 text-[var(--color-fg)]">{formatDateTime(run.scheduledFor)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Início</dt>
              <dd className="tabular mt-0.5 text-[var(--color-fg)]">{formatDateTime(run.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-subtle)]">Duração</dt>
              <dd className="tabular mt-0.5 text-[var(--color-fg)]">{formatDuration(run.startedAt, run.finishedAt)}</dd>
            </div>
          </dl>

          {run.note && <p className="text-xs text-[var(--color-fg-muted)]">{run.note}</p>}

          {run.error && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-[var(--color-danger)]">Erro</h3>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 font-mono text-[11px] text-[var(--color-fg)]">
                {run.error}
              </pre>
            </section>
          )}

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-[var(--color-fg-muted)]">Saída do agente</h3>
            {run.result ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 font-mono text-xs text-[var(--color-fg)]">
                {run.result}
              </pre>
            ) : (
              <p className="text-xs text-[var(--color-fg-subtle)]">Sem saída ainda.</p>
            )}
          </section>

          <section>
            <Button variant="ghost" size="sm" aria-expanded={isLogOpen} onClick={() => setIsLogOpen((current) => !current)}>
              {isLogOpen ? "Esconder log" : "Ver log"}
            </Button>
            {isLogOpen && (
              <>
                {data.isLogTruncated && (
                  <p className="mt-2 text-[11px] text-[var(--color-warning)]">
                    Log grande: mostrando só os últimos 2 MB de {formatMegabytes(data.logSize)}. O arquivo inteiro está no caminho abaixo.
                  </p>
                )}
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
                  {data.log || "Log vazio."}
                </pre>
                <p className="mt-1 break-all text-[11px] text-[var(--color-fg-subtle)]">Arquivo: {data.logFile}</p>
              </>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
