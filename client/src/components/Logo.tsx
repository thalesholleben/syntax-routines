import type { CSSProperties } from "react";
import { Terminal } from "lucide-react";

import type { ExecutorKind } from "../types";

export function Logo({ className = "size-8" }: { className?: string }) {
  return <img src="/brand/syntax-x.svg" alt="Syntax Routines" width={32} height={32} className={className} />;
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`syntax-wordmark ${className}`} aria-label="Syntax Routines">
      <img src="/brand/syntax-logo.svg" alt="Syntax" width={132} height={25} />
      <span>Routines</span>
    </div>
  );
}

/** Marca do provedor pintada com a cor do texto em volta (mask CSS sobre o SVG); script usa o icone de terminal. */
export function ProviderMark({ kind }: { kind: ExecutorKind }) {
  if (kind === "SCRIPT") return <Terminal aria-hidden="true" className="syntax-provider-icon" />;
  return (
    <span
      aria-hidden="true"
      className="syntax-provider"
      style={{ "--provider-mark": `url(/brand/${kind === "CLAUDE" ? "anthropic" : "openai"}.svg)` } as CSSProperties}
    />
  );
}
