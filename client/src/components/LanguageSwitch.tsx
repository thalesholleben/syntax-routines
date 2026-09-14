import { apiRequest } from "../lib/api";
import { cn } from "../lib/cn";
import { LANGUAGES, useI18n, type Language } from "../i18n";

const LABEL: Record<Language, string> = { pt: "PT", en: "EN" };

/**
 * Seletor discreto de idioma. Logado, grava tambem em Ajustes: e de la que o app tira o idioma das
 * notas de execucao e do e-mail, onde nao existe navegador para perguntar.
 */
export function LanguageSwitch({ isAuthenticated, className }: { isAuthenticated: boolean; className?: string }) {
  const { language, m, setLanguage } = useI18n();

  function choose(next: Language) {
    if (next === language) return;
    setLanguage(next);
    if (isAuthenticated) apiRequest("/api/settings/language", { method: "PUT", body: { language: next } }).catch(() => undefined);
  }

  return (
    <div role="group" aria-label={m.language} className={cn("inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)]/60 p-0.5", className)}>
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="button"
          lang={option === "pt" ? "pt-BR" : "en"}
          aria-pressed={language === option}
          aria-label={m.languageName[option]}
          title={m.languageName[option]}
          onClick={() => choose(option)}
          className={cn(
            "cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide transition-colors",
            language === option ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          )}
        >
          {LABEL[option]}
        </button>
      ))}
    </div>
  );
}
