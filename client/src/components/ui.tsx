import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";
import { AlertTriangle } from "lucide-react";

import { useI18n } from "../i18n";
import { cn } from "../lib/cn";
import type { ExecutorKind } from "../types";

type Variant = "primary" | "ghost" | "outline" | "danger" | "subtle";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-[var(--color-primary)] text-[var(--color-primary-fg)] hover:bg-[var(--color-primary-hover)] font-medium",
  danger: "bg-[var(--color-danger)] text-[#121212] hover:opacity-90 font-medium",
  outline: "border border-[var(--color-border-strong)] text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]",
  ghost: "text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]",
  subtle: "bg-[var(--color-surface-3)] text-[var(--color-fg)] hover:bg-[var(--color-border-strong)]"
};

// 44px de altura no toque, como no Ops; menor no desktop.
const SIZE: Record<Size, string> = {
  sm: "h-11 md:h-8 px-3 text-xs gap-1.5",
  md: "h-11 md:h-9 px-4 text-sm gap-2"
};

export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center rounded-[var(--radius-md)] transition-colors disabled:pointer-events-none disabled:opacity-50",
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-primary)]",
        className
      )}
      {...rest}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full resize-none rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none placeholder:text-[var(--color-fg-subtle)] focus:border-[var(--color-primary)]",
        className
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-primary)]",
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({ className, children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label {...rest} className={cn("mb-1.5 block text-xs font-medium text-[var(--color-fg-muted)]", className)}>
      {children}
    </label>
  );
}

const TONE: Record<string, string> = {
  claude: "bg-[var(--harness-claude)]/10 text-[var(--harness-claude)] border-[var(--harness-claude)]/30",
  codex: "bg-[var(--harness-codex)]/10 text-[var(--harness-codex)] border-[var(--harness-codex)]/30",
  script: "bg-[var(--harness-script)]/10 text-[var(--harness-script)] border-[var(--harness-script)]/30",
  primary: "bg-[var(--color-primary)]/15 text-[var(--color-primary)] border-[var(--color-primary)]/30",
  success: "bg-[var(--color-success)]/15 text-[var(--color-success)] border-[var(--color-success)]/30",
  warning: "bg-[var(--color-warning)]/15 text-[var(--color-warning)] border-[var(--color-warning)]/30",
  danger: "bg-[var(--color-danger)]/15 text-[var(--color-danger)] border-[var(--color-danger)]/30",
  info: "bg-[var(--color-info)]/15 text-[var(--color-info)] border-[var(--color-info)]/30",
  muted: "bg-[var(--color-surface-3)] text-[var(--color-fg-muted)] border-[var(--color-border)]"
};

export function Badge({ tone = "muted", children, className }: { tone?: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        TONE[tone] ?? TONE.muted,
        className
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("spin inline-block size-4 rounded-full border-2 border-[var(--color-fg-subtle)] border-t-[var(--color-primary)]", className)}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-2)]", className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)]", className)}>{children}</div>;
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger)]/10 p-3 text-xs text-[var(--color-danger)]"
    >
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/**
 * Modal do Ops sobre <dialog> nativo: showModal deixa o fundo inerte, Escape fecha, Tab da a volta dentro do
 * dialog e o foco volta ao botao que abriu. O foco inicial vai no titulo, para o celular nao abrir o teclado
 * antes de o usuario escolher um campo. `harness` pinta a borda superior com a cor do provedor.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
  harness,
  busy = false
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  harness?: ExecutorKind;
  busy?: boolean;
}) {
  const { m } = useI18n();
  const closeLabel = m.close;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (!dialog.open) dialog.showModal();
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="syntax-dialog"
      data-wide={wide || undefined}
      data-harness={harness}
      aria-labelledby={titleId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const targets = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, summary, [tabindex]")
        ).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
        const first = targets[0];
        const last = targets.at(-1);
        const active = document.activeElement;
        if (!first) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && (active === first || !targets.includes(active as HTMLElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (active === last || !targets.includes(active as HTMLElement))) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <div data-slot="header">
        <h2 id={titleId} tabIndex={-1} className="min-w-0 text-base font-semibold outline-none">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={closeLabel}
          className="shrink-0 cursor-pointer rounded-lg text-xl text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
        >
          ×
        </button>
      </div>
      <div data-slot="body">{open && children}</div>
      {open && footer && <div data-slot="footer">{footer}</div>}
    </dialog>
  );
}
