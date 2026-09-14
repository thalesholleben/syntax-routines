import { useEffect, useState } from "react";

import { useI18n } from "../i18n";
import { apiRequest, formatApiError } from "../lib/api";
import { RUN_STATUS_TONE, useFormat } from "../lib/format";
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
  const { m } = useI18n();
  const f = useFormat();
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
    <Modal open={runId !== null} onClose={onClose} title={m.runTitle(String(runId ?? ""))} wide>
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
            <Badge tone={RUN_STATUS_TONE[run.status]}>{f.runStatusLabel[run.status]}</Badge>
            <Badge tone="muted">{run.triggerType === "MANUAL" ? m.manual : m.scheduled}</Badge>
            {run.agentKind && <Badge tone="info">{f.agentLabel[run.agentKind]}</Badge>}
            {run.attempt > 0 && <Badge tone="muted">{m.attempt(run.attempt)}</Badge>}
          </div>

          <dl className="grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-[var(--color-fg-subtle)]">{m.scheduledFor}</dt>
              <dd className="tabular mt-0.5 text-[var(--color-fg)]">{f.formatDateTime(run.scheduledFor)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-subtle)]">{m.startedAt}</dt>
              <dd className="tabular mt-0.5 text-[var(--color-fg)]">{f.formatDateTime(run.startedAt)}</dd>
            </div>
            <div>
              <dt className="text-[var(--color-fg-subtle)]">{m.duration}</dt>
              <dd className="tabular mt-0.5 text-[var(--color-fg)]">{f.formatDuration(run.startedAt, run.finishedAt)}</dd>
            </div>
          </dl>

          {run.note && <p className="text-xs text-[var(--color-fg-muted)]">{run.note}</p>}

          {run.error && (
            <section>
              <h3 className="mb-1.5 text-xs font-medium text-[var(--color-danger)]">{m.error}</h3>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 font-mono text-[11px] text-[var(--color-fg)]">
                {run.error}
              </pre>
            </section>
          )}

          <section>
            <h3 className="mb-1.5 text-xs font-medium text-[var(--color-fg-muted)]">{m.agentOutput}</h3>
            {run.result ? (
              <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 font-mono text-xs text-[var(--color-fg)]">
                {run.result}
              </pre>
            ) : (
              <p className="text-xs text-[var(--color-fg-subtle)]">{m.noOutputYet}</p>
            )}
          </section>

          <section>
            <Button variant="ghost" size="sm" aria-expanded={isLogOpen} onClick={() => setIsLogOpen((current) => !current)}>
              {isLogOpen ? m.hideLog : m.showLog}
            </Button>
            {isLogOpen && (
              <>
                {data.isLogTruncated && <p className="mt-2 text-[11px] text-[var(--color-warning)]">{m.logTruncated(formatMegabytes(data.logSize))}</p>}
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-[11px] text-[var(--color-fg-muted)]">
                  {data.log || m.emptyLog}
                </pre>
                <p className="mt-1 break-all text-[11px] text-[var(--color-fg-subtle)]">
                  {m.file}: {data.logFile}
                </p>
              </>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
