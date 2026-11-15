/** "− [atual] de [máximo] +": usado nos pontos de vida e nos contadores da ficha. */

interface Props {
  current: number;
  max: number;
  /** Menor valor aceito no máximo (os pontos de vida começam em 1, os contadores em 0). */
  minMax: number;
  onCurrent: (value: number) => void;
  onMax: (value: number) => void;
  labels: { less: string; more: string; current: string; max: string };
}

export function CurrentOfMax({ current, max, minMax, onCurrent, onMax, labels }: Props) {
  return (
    <div className="vital__row">
      <button
        type="button"
        className="round-step"
        onClick={() => onCurrent(Math.max(0, current - 1))}
        aria-label={labels.less}
      >
        −
      </button>
      <input
        className="ink-input ink-input--number"
        type="number"
        min={0}
        value={current}
        onChange={(e) => onCurrent(e.target.valueAsNumber)}
        aria-label={labels.current}
      />
      <span>de</span>
      <input
        className="ink-input ink-input--number"
        type="number"
        min={minMax}
        value={max}
        onChange={(e) => onMax(e.target.valueAsNumber)}
        aria-label={labels.max}
      />
      <button
        type="button"
        className="round-step"
        onClick={() => onCurrent(Math.min(max, current + 1))}
        aria-label={labels.more}
      >
        +
      </button>
    </div>
  );
}
