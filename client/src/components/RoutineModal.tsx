import { useEffect, useId, useState } from "react";
import { AlertTriangle, Check, FolderTree, Save, SlidersHorizontal } from "lucide-react";

import { useI18n } from "../i18n";
import { apiRequest, formatApiError } from "../lib/api";
import { useFormat } from "../lib/format";
import type { AgentKind, AgentsMeta, ExecutorKind, MissedPolicy, RoutineDto, RoutinePayload } from "../types";
import { EffortToggle } from "./EffortToggle";
import { ProviderMark } from "./Logo";
import { Button, Input, Label, Modal, Select, Spinner, Textarea } from "./ui";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_INTERVAL_MINUTES = 15;

const EXECUTORS: ExecutorKind[] = ["CLAUDE", "CODEX", "SCRIPT"];

const NEW_ROUTINE: RoutinePayload = {
  name: "",
  agentKind: "CLAUDE",
  directory: "",
  model: null,
  effort: "medium",
  timeoutMinutes: 60,
  isFallbackEnabled: true,
  days: [1, 2, 3, 4, 5],
  time: "09:00",
  intervalMinutes: null,
  prompt: "",
  command: "",
  missedPolicy: "RUN_ON_BOOT",
  isEnabled: true
};

function toPayload(routine: RoutineDto): RoutinePayload {
  const { name, agentKind, directory, model, effort, timeoutMinutes, isFallbackEnabled, days, time, intervalMinutes, prompt, command, missedPolicy, isEnabled } =
    routine;
  return {
    name,
    agentKind,
    directory,
    model,
    effort: effort || "medium",
    timeoutMinutes,
    isFallbackEnabled,
    days,
    time,
    intervalMinutes,
    prompt,
    command: command ?? "",
    missedPolicy,
    isEnabled
  };
}

/**
 * Modal de rotina com a anatomia do despacho do Syntax Ops: executor em cartoes, esforco como chave
 * deslizante, prompt (ou comando, no script), diretorio e ajustes recolhidos. Aqui entram tambem nome,
 * dias, hora ou intervalo e a politica de PC desligado. A cor do executor escolhido pinta a borda do
 * modal, os cartoes e o botao de salvar.
 */
export function RoutineModal({
  open,
  routine,
  agents,
  rootDirectory,
  bootDelayMinutes,
  onSaved,
  onClose
}: {
  open: boolean;
  routine: RoutineDto | null;
  agents: AgentsMeta;
  rootDirectory: string;
  bootDelayMinutes: number;
  onSaved: (routine: RoutineDto) => void;
  onClose: () => void;
}) {
  const { m } = useI18n();
  const f = useFormat();
  const baseId = useId();
  const [form, setForm] = useState<RoutinePayload>(NEW_ROUTINE);
  const [directories, setDirectories] = useState<string[]>([]);
  const [directoryNote, setDirectoryNote] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const routineId = routine?.id ?? null;

  // So reinicia o formulario ao abrir ou trocar de rotina: o polling da lista nao pode apagar o que foi digitado.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(routine ? toPayload(routine) : { ...NEW_ROUTINE, timeoutMinutes: agents.timeoutDefaultMinutes, directory: rootDirectory });
    let isAlive = true;
    apiRequest<{ rootDirectory: string; directories: string[] }>("/api/settings/directories")
      .then((data) => {
        if (!isAlive) return;
        setDirectories(data.directories);
        setDirectoryNote(null);
      })
      .catch((err: unknown) => {
        if (isAlive) setDirectoryNote(formatApiError(err));
      });
    return () => {
      isAlive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, routineId]);

  const isScript = form.agentKind === "SCRIPT";
  const agentKind: AgentKind = form.agentKind === "SCRIPT" ? "CLAUDE" : form.agentKind;
  const models = agents.models[agentKind];
  const efforts = agents.efforts[agentKind];
  const isTopEffort = form.effort === efforts[efforts.length - 1];
  const isInterval = form.intervalMinutes !== null;
  const directoryOptions = form.directory && !directories.includes(form.directory) ? [form.directory, ...directories] : directories;
  const hasDirectory = directoryOptions.length > 0;
  const missedLabel = isInterval ? m.missedNext : form.missedPolicy === "RUN_ON_BOOT" ? m.missedRunOnBoot : m.missedSkip;
  const summary = [
    f.agentLabel[form.agentKind],
    ...(isScript ? [] : [form.effort]),
    m.minutes(form.timeoutMinutes),
    f.formatSchedule(form.days, form.time, form.intervalMinutes)
  ].join(" · ");

  function update(patch: Partial<RoutinePayload>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  // Trocar de executor invalida modelo e effort do anterior, como no Ops; script nao tem nenhum dos dois.
  function chooseExecutor(kind: ExecutorKind) {
    setForm((current) => {
      if (kind === "SCRIPT") return { ...current, agentKind: kind, model: null, isFallbackEnabled: false };
      return {
        ...current,
        agentKind: kind,
        model: current.model && agents.models[kind].some((option) => option.value === current.model) ? current.model : null,
        effort: agents.efforts[kind].includes(current.effort) ? current.effort : "medium"
      };
    });
  }

  function toggleDay(day: number) {
    setForm((current) => ({
      ...current,
      days: current.days.includes(day) ? current.days.filter((value) => value !== day) : [...current.days, day].sort((a, b) => a - b)
    }));
  }

  async function submit() {
    if (isBusy) return;
    setError(null);
    if (!form.name.trim()) return setError(m.vName);
    if (!form.directory) return setError(m.vDirectory);
    if (form.days.length === 0) return setError(m.vDays);
    if (!isInterval && !TIME_PATTERN.test(form.time)) return setError(m.vTime);
    if (isScript && !form.command.trim()) return setError(m.vCommand);
    if (!isScript && !form.prompt.trim()) return setError(m.vPrompt);
    setIsBusy(true);
    // O servidor normaliza o resto (script sem prompt, agente sem comando); aqui so nao se manda lixo do outro modo.
    const body: RoutinePayload = isScript ? { ...form, prompt: "", model: null, isFallbackEnabled: false } : { ...form, command: "" };
    try {
      const response = routine
        ? await apiRequest<{ routine: RoutineDto }>(`/api/routines/${routine.id}`, { method: "PUT", body })
        : await apiRequest<{ routine: RoutineDto }>("/api/routines", { method: "POST", body });
      onSaved(response.routine);
      onClose();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={routine ? m.editRoutine : m.newRoutine}
      wide
      harness={form.agentKind}
      busy={isBusy}
      footer={
        <div className="space-y-2">
          <div aria-live="polite" className="h-10 overflow-y-auto text-xs text-[var(--color-fg-muted)]">
            {error ? (
              <p role="alert" className="flex items-start gap-2 text-[var(--color-danger)]">
                <AlertTriangle className="size-4 shrink-0" />
                {error}
              </p>
            ) : !hasDirectory ? (
              m.needRootToSave
            ) : (
              summary
            )}
          </div>
          <div className="grid grid-cols-[0.8fr_1.2fr] gap-2 md:flex md:justify-end">
            <Button variant="outline" onClick={onClose} disabled={isBusy}>
              {m.cancel}
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={isBusy || !hasDirectory}
              className="bg-[var(--dispatch-color)] text-[#121212] hover:bg-[var(--dispatch-color)] hover:opacity-90"
            >
              {isBusy ? <Spinner /> : <Save className="size-4" />} {isBusy ? m.saving : m.saveRoutine}
            </Button>
          </div>
        </div>
      }
    >
      <fieldset disabled={isBusy} className="syntax-dispatch">
        <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">{m.modalIntro}</p>

        <div>
          <Label htmlFor={`${baseId}-name`}>{m.routineName}</Label>
          <Input
            id={`${baseId}-name`}
            value={form.name}
            maxLength={80}
            placeholder={m.routineNamePlaceholder}
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>

        <fieldset>
          <legend>{m.stepExecutor}</legend>
          <div data-slot="providers">
            {EXECUTORS.map((kind) => (
              <button key={kind} type="button" aria-pressed={form.agentKind === kind} onClick={() => chooseExecutor(kind)} aria-label={m.executorAria[kind]}>
                <ProviderMark kind={kind} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-semibold text-[var(--color-fg)]">{f.agentLabel[kind]}</span>
                  <span className="mt-1 block text-xs">{m.executorSubtitle[kind]}</span>
                </span>
                {/* No celular a borda colorida ja mostra qual esta escolhido; o texto fica so no desktop. */}
                <span className="hidden items-center gap-1 text-xs md:inline-flex">
                  {form.agentKind === kind ? (
                    <>
                      <Check className="size-3.5" />
                      {m.selected}
                    </>
                  ) : (
                    m.select
                  )}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* Modelo e esforco dividem a linha tambem no celular, metade cada. Script nao tem nenhum dos dois. */}
        {!isScript && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1.3fr] md:gap-4">
            <div className="min-w-0">
              <label htmlFor={`${baseId}-model`} data-slot="field-title">
                {m.model}
              </label>
              <Select id={`${baseId}-model`} value={form.model ?? ""} onChange={(event) => update({ model: event.target.value || null })}>
                <option value="">{m.cliDefault}</option>
                {models.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <fieldset>
              {/* O nivel escolhido e o proprio titulo do campo: muda junto com a chave. */}
              <legend id={`${baseId}-effort`} data-slot="field-title">
                {m.effort} ·{" "}
                <span data-slot="effort-level" data-top={isTopEffort || undefined}>
                  {form.effort}
                </span>
              </legend>
              <EffortToggle levels={efforts} value={form.effort} onChange={(effort) => update({ effort })} labelledBy={`${baseId}-effort`} disabled={isBusy} />
            </fieldset>
          </div>
        )}

        <fieldset>
          <legend>{m.stepWhen}</legend>
          <div className="mb-3" role="group" aria-label={m.timeMode} data-slot="mode">
            <button type="button" aria-pressed={!isInterval} onClick={() => update({ intervalMinutes: null })}>
              {m.fixedTime}
            </button>
            <button type="button" aria-pressed={isInterval} onClick={() => update({ intervalMinutes: DEFAULT_INTERVAL_MINUTES })}>
              {m.everyInterval}
            </button>
          </div>
          <div data-slot="when">
            <div role="group" aria-label={m.weekDays} data-slot="days">
              {f.weekDays.map((day) => (
                <button key={day.value} type="button" aria-pressed={form.days.includes(day.value)} onClick={() => toggleDay(day.value)}>
                  {day.label}
                </button>
              ))}
            </div>
            {isInterval ? (
              <div>
                <Label htmlFor={`${baseId}-interval`}>{m.every}</Label>
                <Select
                  id={`${baseId}-interval`}
                  value={String(form.intervalMinutes)}
                  onChange={(event) => update({ intervalMinutes: Number(event.target.value) })}
                >
                  {agents.intervalOptions.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {f.formatInterval(minutes)}
                    </option>
                  ))}
                </Select>
              </div>
            ) : (
              <div>
                <Label htmlFor={`${baseId}-time`}>{m.time}</Label>
                <Input id={`${baseId}-time`} type="time" required value={form.time} onChange={(event) => update({ time: event.target.value })} />
              </div>
            )}
          </div>
          {isInterval && (
            <p className="mt-2 text-xs text-[var(--color-fg-muted)]">{m.intervalHint}</p>
          )}
        </fieldset>

        {isScript ? (
          <section>
            <Label htmlFor={`${baseId}-command`}>{m.stepCommand}</Label>
            <Input
              id={`${baseId}-command`}
              value={form.command}
              maxLength={agents.commandMaxChars}
              placeholder={m.commandPlaceholder}
              onChange={(event) => update({ command: event.target.value })}
              className="font-mono"
              aria-describedby={`${baseId}-command-hint`}
            />
            <p id={`${baseId}-command-hint`} className="mt-2 text-xs text-[var(--color-fg-muted)]">
              {m.commandHint}
            </p>
          </section>
        ) : (
          <section>
            <Label htmlFor={`${baseId}-prompt`}>{m.stepPrompt}</Label>
            <Textarea
              id={`${baseId}-prompt`}
              rows={7}
              maxLength={20_000}
              value={form.prompt}
              onChange={(event) => update({ prompt: event.target.value })}
              className="font-mono"
              aria-describedby={`${baseId}-prompt-hint`}
            />
            <p id={`${baseId}-prompt-hint`} className="mt-2 text-xs text-[var(--color-fg-muted)]">
              {m.promptHint}
            </p>
          </section>
        )}

        <div>
          <Label htmlFor={`${baseId}-directory`}>
            <span className="inline-flex items-center gap-1.5">
              <FolderTree className="size-4" />
              {m.stepDirectory}
            </span>
          </Label>
          <Select
            id={`${baseId}-directory`}
            value={form.directory}
            onChange={(event) => update({ directory: event.target.value })}
            aria-describedby={directoryNote ? `${baseId}-directory-note` : undefined}
            aria-invalid={!form.directory}
          >
            {!hasDirectory && <option value="">{m.configureRoot}</option>}
            {directoryOptions.map((directory) => (
              <option key={directory} value={directory}>
                {directory === rootDirectory ? `${directory} ${m.rootSuffix}` : directory}
              </option>
            ))}
          </Select>
          {directoryNote && (
            <p id={`${baseId}-directory-note`} className="mt-2 break-words text-xs text-[var(--color-warning)]">
              {directoryNote}
            </p>
          )}
        </div>

        <details>
          <summary>
            <SlidersHorizontal className="mr-2 inline size-4" />
            {m.runSettings}{" "}
            <span className="font-normal text-[var(--color-fg-muted)]">
              · {m.minutes(form.timeoutMinutes)} · {missedLabel}
            </span>
          </summary>
          <div className="grid gap-4 border-t border-[var(--color-border)] p-3 md:p-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor={`${baseId}-timeout`}>{m.timeout}</Label>
                <Select id={`${baseId}-timeout`} value={String(form.timeoutMinutes)} onChange={(event) => update({ timeoutMinutes: Number(event.target.value) })}>
                  {agents.timeoutOptions.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {m.minutes(minutes)}
                    </option>
                  ))}
                </Select>
              </div>
              {!isInterval && (
                <div>
                  <Label htmlFor={`${baseId}-missed`}>{m.ifPcOff}</Label>
                  <Select id={`${baseId}-missed`} value={form.missedPolicy} onChange={(event) => update({ missedPolicy: event.target.value as MissedPolicy })}>
                    <option value="RUN_ON_BOOT">{bootDelayMinutes > 0 ? m.runOnBootAfter(bootDelayMinutes) : m.runOnBootNow}</option>
                    <option value="SKIP">{m.skipThisTime}</option>
                  </Select>
                </div>
              )}
            </div>
            {!isScript && (
              <label className="flex cursor-pointer items-start gap-3 py-2 text-sm text-[var(--color-fg-muted)]">
                <input
                  type="checkbox"
                  checked={form.isFallbackEnabled}
                  onChange={(event) => update({ isFallbackEnabled: event.target.checked })}
                  className="mt-1 size-5 shrink-0"
                />
                <span>
                  {m.fallbackLabel}
                  <span className="mt-1 block text-xs">{m.fallbackHint}</span>
                </span>
              </label>
            )}
            <label className="flex cursor-pointer items-start gap-3 py-2 text-sm text-[var(--color-fg-muted)]">
              <input type="checkbox" checked={form.isEnabled} onChange={(event) => update({ isEnabled: event.target.checked })} className="mt-1 size-5 shrink-0" />
              <span>
                {m.enabledLabel}
                <span className="mt-1 block text-xs">{m.enabledHint}</span>
              </span>
            </label>
          </div>
        </details>
      </fieldset>
    </Modal>
  );
}
