import { useRef, type CSSProperties, type KeyboardEvent } from "react";

/**
 * Esforco como chave de varios niveis, igual ao Ops: um trilho com uma parada por nivel e um botao que
 * desliza entre elas. Aceita toque, arraste e setas do teclado. Nao tem rotulo proprio: o nivel escolhido
 * aparece no titulo do campo (labelledBy).
 */
export function EffortToggle({
  levels,
  value,
  onChange,
  labelledBy,
  disabled
}: {
  levels: readonly string[];
  value: string;
  onChange: (level: string) => void;
  labelledBy: string;
  disabled?: boolean;
}) {
  const railRef = useRef<HTMLSpanElement>(null);
  const last = levels.length - 1;
  const index = Math.max(0, levels.indexOf(value));
  const ratio = last > 0 ? index / last : 0;

  function select(next: number) {
    const level = levels[Math.min(last, Math.max(0, next))];
    if (!disabled && level && level !== value) onChange(level);
  }

  // A posicao conta so dentro do trilho: a caixa em volta existe para a area de toque.
  function selectAt(clientX: number) {
    const rail = railRef.current;
    if (!rail || last <= 0) return;
    const { left, width } = rail.getBoundingClientRect();
    select(Math.round(((clientX - left) / width) * last));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      Home: 0,
      End: last
    };
    if (!(event.key in target)) return;
    event.preventDefault();
    select(target[event.key]);
  }

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-labelledby={labelledBy}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index}
      aria-valuetext={value}
      aria-disabled={disabled || undefined}
      title="Mais esforço pode consumir mais tempo e cota."
      data-slot="effort"
      data-top={index === last || undefined}
      style={{ "--ratio": ratio } as CSSProperties}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (disabled) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        selectAt(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) selectAt(event.clientX);
      }}
    >
      <span ref={railRef} data-slot="rail">
        <span data-slot="fill" />
        {levels.map((level, position) => (
          <span key={level} data-slot="stop" data-on={position <= index || undefined} style={{ "--at": last > 0 ? position / last : 0 } as CSSProperties} />
        ))}
        <span data-slot="thumb" />
      </span>
    </div>
  );
}
