import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-4 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur md:px-6">
      <div className="min-w-0 flex-1 basis-32">
        <p className="mb-1 text-xs font-medium text-[var(--color-primary)]">Syntax Routines</p>
        <h1 className="text-lg font-semibold text-[var(--color-fg)]">{title}</h1>
        {subtitle && <p className="truncate text-xs text-[var(--color-fg-subtle)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
