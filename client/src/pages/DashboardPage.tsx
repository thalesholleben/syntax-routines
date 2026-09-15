import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Activity, ArrowUpRight, CheckCheck, Clock3, RefreshCw, Terminal, Zap } from "lucide-react";

import type { DashboardSnapshot } from "../../../server/src/dashboard";
import { ProviderMark } from "../components/Logo";
import { PageHeader } from "../components/PageHeader";
import { RunOutputModal } from "../components/RunOutputModal";
import { Badge, Button, ErrorBox, Skeleton } from "../components/ui";
import { LOCALE, useI18n } from "../i18n";
import { apiRequest, formatApiError } from "../lib/api";
import { RUN_STATUS_TONE, useFormat } from "../lib/format";
import type { ExecutorKind, StatusDto } from "../types";
import "./dashboard.css";

type Period = "24" | "168" | "720";
const KINDS: ExecutorKind[] = ["CLAUDE", "CODEX", "SCRIPT"];
const HOUR = 3_600_000;

export function DashboardPage() {
  const { m, language } = useI18n();
  const f = useFormat();
  const [period, setPeriod] = useState<Period>("24");
  const [snapshot, setSnapshot] = useState<{ data: DashboardSnapshot; status: StatusDto } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const [data, status] = await Promise.all([
          apiRequest<DashboardSnapshot>(`/api/dashboard?hours=${period}`, { signal: controller.signal }),
          apiRequest<StatusDto>("/api/status", { signal: controller.signal })
        ]);
        if (controller.signal.aborted) return;
        setSnapshot({ data, status });
        setError(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(formatApiError(err));
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), document.hidden ? 30_000 : 5000);
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [period, language, refresh]);

  const data = snapshot?.data;
  const status = snapshot?.status;
  const isChangingPeriod = data !== undefined && data.hours !== Number(period);
  // O relogio re-renderiza a tela a cada segundo; os formatadores sao caros de construir, por isso vivem entre renders.
  const timezone = data?.timezone;
  const formats = useMemo(() => ({
    time: new Intl.DateTimeFormat(LOCALE[language], { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }),
    dateTime: new Intl.DateTimeFormat(LOCALE[language], {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone
    }),
    number: new Intl.NumberFormat(LOCALE[language], { maximumFractionDigits: 1 })
  }), [language, timezone]);
  const time = (at: number) => formats.time.format(at);
  const dateTime = (at: number) => formats.dateTime.format(at);
  const number = (n: number) => formats.number.format(n);
  const rate = (summary: DashboardSnapshot["summary"]) => {
    const total = summary.succeeded + summary.failed;
    return total > 0 ? `${number(summary.failed / total * 100)}%` : null;
  };
  const isHealthy = Boolean(status?.lastTickAt && clock - status.lastTickAt < 90_000);
  const selectedSlot = selectedHour === null ? null : data?.horizon[selectedHour];
  const events = selectedSlot?.events ?? data?.upcoming ?? [];
  const eventCount = selectedSlot ? selectedSlot.CLAUDE + selectedSlot.CODEX + selectedSlot.SCRIPT : data?.upcomingCount ?? 0;
  const activityMax = Math.max(1, ...data?.activity.map(slot => slot.succeeded + slot.failed + slot.other) ?? []);
  const horizonMax = Math.max(1, ...data?.horizon.flatMap(slot => KINDS.map(kind => slot[kind])) ?? []);
  const completed = data ? data.summary.succeeded + data.summary.failed : 0;

  return <div className="sr-dashboard">
    <PageHeader title={m.dashTitle} subtitle={m.dashSubtitle} actions={<>
      <select aria-label={m.dashPeriod} value={period} onChange={event => setPeriod(event.target.value as Period)}>
        {(["24", "168", "720"] as const).map(value => <option key={value} value={value}>{m.dashPeriods[value]}</option>)}
      </select>
      <Button variant="ghost" size="sm" aria-label={m.dashRefresh} onClick={() => setRefresh(value => value + 1)}><RefreshCw size={15} aria-hidden /></Button>
    </>} />
    <div className="sr-dashboard__scroll">
      <div className="sr-dashboard__body">
        {error && <ErrorBox>{data ? m.staleData(error) : error}</ErrorBox>}
        {!data || !status || isChangingPeriod ? <div aria-busy="true" aria-label={m.dashLoading} className="space-y-4">
          <Skeleton className="h-24" /><Skeleton className="h-64" /><Skeleton className="h-64" />
        </div> : <>
          <section className="sr-dashboard__overview" aria-label={m.dashOverview}>
            <div><span className="sr-dashboard__eyebrow">{m.dashOverview}</span><h2>{m.dashFleet(data.enabledCount, data.routineCount)}</h2>
              <p>{data.routineCount - data.enabledCount} {m.paused.toLowerCase()} <span>·</span> {data.timezone}</p></div>
            <div className="sr-dashboard__health" data-state={isHealthy && !error ? "ok" : "warning"}>
              <span><Activity size={15} aria-hidden />{!status.lastTickAt ? m.dashTickUnknown : isHealthy ? m.dashHealth : m.dashTickLate}</span>
              <small>{m.dashTick}: {status.lastTickAt ? time(status.lastTickAt) : m.noDate}</small>
            </div>
          </section>

          <section className="sr-dashboard__metrics" aria-label={m.dashPeriods[period]}>
            <article><span>{m.dashCompleted}</span><strong>{number(completed)}</strong><small>{number(data.summary.succeeded)} {m.dashSuccess}</small>
              <div className="sr-dashboard__ratio" aria-hidden><i style={{ width: `${completed ? data.summary.succeeded / completed * 100 : 0}%` }} /></div>
            </article>
            <article><span>{m.dashErrors}</span><strong data-tone={data.summary.failed ? "danger" : "success"}>{rate(data.summary) ?? m.noDate}</strong>
              <small>{completed ? m.dashErrorBasis(data.summary.failed, completed) : m.dashNoData}</small>
              <p>{rate(data.previous) ? `${rate(data.previous)} ${m.dashPrevious}` : m.dashNoComparison}</p></article>
            <article><span>{m.dashDuration}</span><strong>{data.summary.averageMs === null ? m.noDate : f.formatDuration(1, 1 + data.summary.averageMs)}</strong>
              <small>{m.dashDurationHint}</small><p>{data.summary.skipped} {m.runStatus.SKIPPED.toLowerCase()} · {data.summary.canceled} {m.runStatus.CANCELED.toLowerCase()}</p></article>
            <article><span>{m.dashCapacity}</span><strong>{data.running}<em> / {data.maxParallel}</em></strong><small>{m.dashSlots(data.maxParallel, data.queued)}</small>
              <div className="sr-dashboard__capacity" aria-hidden>{Array.from({ length: data.maxParallel }, (_, i) => <i key={i} className={i < data.running ? "is-filled" : undefined} />)}</div>
            </article>
          </section>

          <div className="sr-dashboard__primary">
            <section className="sr-dashboard__panel sr-dashboard__horizon">
              <div className="sr-dashboard__heading"><div><h2><Zap size={16} aria-hidden />{m.dashHorizon}</h2><p>{m.dashHorizonHint}</p></div><Badge tone="primary">{m.dashOccurrences(data.upcomingCount)}</Badge></div>
              <div className="sr-dashboard__horizon-scroll"><div className="sr-dashboard__horizon-grid">
                <div className="sr-dashboard__axis"><span>{m.dashNow}</span>{[0, 6, 12, 18].map(i => <span key={i} style={{ gridColumn: `${i + 2} / span 6` }}>{time(data.horizon[i].at)}</span>)}</div>
                {KINDS.map(kind => <div className="sr-dashboard__lane" key={kind}>
                  <span><ProviderMark kind={kind} />{f.agentLabel[kind]}</span>
                  {data.horizon.map((slot, i) => <button key={i} type="button" aria-pressed={selectedHour === i}
                    aria-label={m.dashHour(f.agentLabel[kind], dateTime(slot.at), dateTime(slot.at + HOUR), slot[kind])}
                    title={m.dashHour(f.agentLabel[kind], time(slot.at), time(slot.at + HOUR), slot[kind])}
                    style={{ "--sr-density": slot[kind] ? 0.16 + slot[kind] / horizonMax * 0.74 : 0 } as CSSProperties}
                    onClick={() => setSelectedHour(selectedHour === i ? null : i)}>{slot[kind] || ""}</button>)}
                </div>)}
              </div></div>
              <div className="sr-dashboard__horizon-footer"><span>{m.dashForecast}</span><span>{m.dashQuiet}<i aria-hidden />{m.dashBusy}</span></div>
            </section>
            <section className="sr-dashboard__next">
              <span className="sr-dashboard__eyebrow"><Clock3 size={15} aria-hidden />{m.dashNext}</span>
              {data.next ? <><strong>{time(data.next.at)}</strong><h2>{data.next.name}</h2><p>{f.agentLabel[data.next.agentKind]} · {dateTime(data.next.at)}</p>
                <span className="sr-dashboard__countdown">{data.next.at <= clock ? m.dashWaiting : f.formatRelative(data.next.at, clock)}</span></> : <><Clock3 className="my-5 size-10 opacity-40" aria-hidden /><h2>{m.dashNoNext}</h2></>}
            </section>
          </div>

          {KINDS.filter(kind => kind !== "SCRIPT").map(kind => {
            const limit = status.limits[kind as "CLAUDE" | "CODEX"];
            return limit.isOnLimit ? <div className="sr-dashboard__notice" role="status" key={kind}>{m.limitNotice(f.agentLabel[kind], limit.resetAt ? m.limitUntil(dateTime(Date.parse(limit.resetAt))) : "")}</div> : null;
          })}

          <div className="sr-dashboard__columns">
            <div className="sr-dashboard__stack">
              <section className="sr-dashboard__panel">
                <div className="sr-dashboard__heading"><div><h2><Activity size={16} aria-hidden />{m.dashQueue}</h2><p>{m.dashQueueHint}</p></div><Badge tone="primary">{data.running + data.queued}</Badge></div>
                {data.active.length ? <div className="sr-dashboard__live-list">{data.active.map(run => <div className="sr-dashboard__live-run" key={run.id}>
                  <ProviderMark kind={run.agentKind} /><div><h3>{run.name}</h3><p>{run.status === "RUNNING" ? f.formatDuration(run.startedAt, clock) : run.runAt && run.runAt > clock ? `${m.dashReady} ${dateTime(run.runAt)}` : m.dashWaiting}</p></div>
                  <Badge tone={RUN_STATUS_TONE[run.status]}>{f.runStatusLabel[run.status]}</Badge><Button size="sm" variant="ghost" onClick={() => setRunId(run.id)} aria-label={`${m.dashLog}: ${run.name}`}><Terminal size={16} aria-hidden /></Button>
                </div>)}{data.active.length < data.running + data.queued && <p className="sr-dashboard__footnote">{m.dashShowing(data.active.length, data.running + data.queued)}</p>}</div>
                  : <div className="sr-dashboard__empty"><CheckCheck size={25} aria-hidden /><div><h3>{m.dashIdle}</h3><p>{m.dashIdleHint}</p></div></div>}
              </section>

              <section className="sr-dashboard__panel">
                <div className="sr-dashboard__heading"><div><h2>{m.dashActivity}</h2><p>{m.dashActivityHint}</p></div><span className="sr-dashboard__eyebrow">{m.dashPeriods[period]}</span></div>
                <div className="sr-dashboard__chart" role="list" aria-label={m.dashActivity}>
                  {data.activity.map(slot => <div role="listitem" key={slot.at} tabIndex={0}
                    title={m.dashActivityBucket(dateTime(slot.at), slot.succeeded, slot.failed, slot.other)}
                    aria-label={m.dashActivityBucket(dateTime(slot.at), slot.succeeded, slot.failed, slot.other)}>
                    <i data-tone="other" style={{ height: `${slot.other / activityMax * 100}%` }} /><i data-tone="danger" style={{ height: `${slot.failed / activityMax * 100}%` }} /><i data-tone="success" style={{ height: `${slot.succeeded / activityMax * 100}%` }} />
                  </div>)}
                  <span className="sr-dashboard__chart-max" aria-hidden>{activityMax}</span>
                </div>
                <div className="sr-dashboard__chart-axis"><span>{dateTime(data.from)}</span><span>{dateTime(data.now)}</span></div>
                <div className="sr-dashboard__legend"><span data-tone="success">{m.dashSuccess}</span><span data-tone="danger">{m.dashFailures(data.summary.failed)}</span><span>{m.dashOther}</span></div>
                {!completed && !data.summary.skipped && !data.summary.canceled && <p className="sr-dashboard__footnote">{m.dashNoData}</p>}
              </section>

              <section className="sr-dashboard__panel">
                <div className="sr-dashboard__heading"><div><h2>{m.dashLatest}</h2><p>{m.dashLatestHint}</p></div></div>
                {data.recent.length ? <div className="sr-dashboard__table-scroll"><table><thead><tr><th>{m.dashRoutine}</th><th>{m.dashResult}</th><th>{m.dashFinished}</th><th>{m.dashElapsed}</th><th><span className="sr-only">{m.dashLog}</span></th></tr></thead>
                  <tbody>{data.recent.map(run => <tr key={run.id}><td><span title={run.name}>{run.name}</span><small>{f.agentLabel[run.agentKind]} · #{run.id}</small></td><td><Badge tone={RUN_STATUS_TONE[run.status]}>{f.runStatusLabel[run.status]}</Badge></td><td>{run.finishedAt ? dateTime(run.finishedAt) : m.noDate}</td><td>{f.formatDuration(run.startedAt, run.finishedAt)}</td><td><Button size="sm" variant="ghost" onClick={() => setRunId(run.id)} aria-label={`${m.dashLog}: ${run.name} #${run.id}`}><ArrowUpRight size={16} aria-hidden /></Button></td></tr>)}</tbody></table></div> : <p className="sr-dashboard__footnote">{m.dashNoData}</p>}
              </section>
            </div>

            <aside className="sr-dashboard__stack">
              <section className="sr-dashboard__panel">
                <div className="sr-dashboard__heading"><div><h2>{selectedSlot ? m.dashWindow : m.dashTimeline}</h2><p>{selectedSlot ? `${time(selectedSlot.at)} → ${time(selectedSlot.at + HOUR)}` : m.dashOccurrences(data.upcomingCount)}</p></div></div>
                {selectedHour !== null && <Button size="sm" variant="ghost" onClick={() => setSelectedHour(null)}>{m.dashAllHours}</Button>}
                <ol className="sr-dashboard__agenda">{events.map(event => <li key={`${event.routineId}-${event.at}`}><time>{time(event.at)}</time><div><h3>{event.name}</h3><p>{f.agentLabel[event.agentKind]} · {dateTime(event.at)}</p></div></li>)}</ol>
                <p className="sr-dashboard__footnote">{events.length ? m.dashShowing(events.length, eventCount) : m.dashNoEvents}</p>
              </section>
              <section className="sr-dashboard__panel">
                <div className="sr-dashboard__heading"><div><h2>{m.dashAttention}</h2><p>{m.dashAttentionHint}</p></div></div>
                {data.failures.length ? <ol className="sr-dashboard__failures">{data.failures.map((failure, i) => <li key={failure.routineId}>
                  <span>{String(i + 1).padStart(2, "0")}</span><div><h3>{failure.name}</h3><p>{m.dashFailures(failure.count)} · {dateTime(failure.lastAt)}</p></div><Button size="sm" variant="ghost" onClick={() => setRunId(failure.runId)} aria-label={`${m.dashLog}: ${failure.name}`}><ArrowUpRight size={16} aria-hidden /></Button>
                </li>)}</ol> : <p className="sr-dashboard__footnote">{m.dashNoFailures}</p>}
              </section>
            </aside>
          </div>
          <footer className="sr-dashboard__footer"><p>{m.dashBasis}<br />{m.dashRetention}</p><span>{m.dashLive} · {m.dashUpdated} {time(data.now)}</span></footer>
        </>}
      </div>
    </div>
    <RunOutputModal runId={runId} onClose={() => setRunId(null)} />
  </div>;
}
