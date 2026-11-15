import { useState, type KeyboardEvent } from "react";
import type { StatMap } from "../api/characters";
import { signed, toKey, toLabel } from "../labels";
import { DieIcon } from "./DiceTray";

interface Props {
  /** "boxes": caixas de atributo; "rows": linhas pontilhadas de perícia. */
  variant: "boxes" | "rows";
  stats: StatMap;
  onChange: (next: StatMap) => void;
  noun: string; // "atributo" | "perícia"
  min?: number;
  max?: number;
  /** Se informado, cada linha ganha um botão de rolagem (usado nas perícias: d20 + valor). */
  onRoll?: (key: string, value: number) => void;
}

export function StatsEditor({
  variant,
  stats,
  onChange,
  noun,
  min = -1000,
  max = 1000,
  onRoll,
}: Props) {
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const entries = Object.entries(stats);

  const set = (key: string, value: number) => {
    if (Number.isNaN(value)) return;
    onChange({ ...stats, [key]: Math.max(min, Math.min(max, Math.trunc(value))) });
  };
  const remove = (key: string) => {
    const next = { ...stats };
    delete next[key];
    onChange(next);
  };
  const add = () => {
    const key = toKey(name);
    if (!key)
      return setProblem(
        `Dê um nome para ${noun === "perícia" ? "a" : "o"} ${noun}, começando por uma letra.`,
      );
    if (key in stats) return setProblem(`${toLabel(key)} já está na ficha.`);
    if (entries.length >= 64) return setProblem("A ficha comporta até 64 entradas.");
    onChange({ ...stats, [key]: variant === "boxes" ? 10 : 0 });
    setName("");
    setProblem("");
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault(); // não deixa o Enter enviar o formulário de fora
    add();
  };

  return (
    <div className="stats">
      {variant === "boxes" ? (
        <ul className="stat-grid">
          {entries.map(([key, value]) => (
            <li key={key} className="stat-box">
              <span className="stat-box__name">{toLabel(key)}</span>
              <input
                className="stat-box__value"
                type="number"
                value={value}
                aria-label={toLabel(key)}
                onChange={(e) => set(key, e.target.valueAsNumber)}
              />
              <span className="stat-box__steps">
                <button
                  type="button"
                  onClick={() => set(key, value - 1)}
                  aria-label={`Diminuir ${toLabel(key)}`}
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={() => set(key, value + 1)}
                  aria-label={`Aumentar ${toLabel(key)}`}
                >
                  +
                </button>
              </span>
              <button
                type="button"
                className="stat-box__remove"
                onClick={() => remove(key)}
                aria-label={`Remover ${toLabel(key)}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="stat-rows">
          {entries.map(([key, value]) => (
            <li key={key} className="stat-row">
              <span className="stat-row__name">{toLabel(key)}</span>
              <span className="stat-row__dots" aria-hidden="true" />
              {onRoll && (
                <button
                  type="button"
                  className="roll-button"
                  onClick={() => onRoll(key, value)}
                  aria-label={`Rolar ${toLabel(key)}: d20 ${signed(value)}`}
                >
                  <DieIcon sides={20} />
                </button>
              )}
              <button
                type="button"
                className="stat-row__step"
                onClick={() => set(key, value - 1)}
                aria-label={`Diminuir ${toLabel(key)}`}
              >
                −
              </button>
              <output className="stat-row__value">{signed(value)}</output>
              <button
                type="button"
                className="stat-row__step"
                onClick={() => set(key, value + 1)}
                aria-label={`Aumentar ${toLabel(key)}`}
              >
                +
              </button>
              <button
                type="button"
                className="stat-row__remove"
                onClick={() => remove(key)}
                aria-label={`Remover ${toLabel(key)}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {entries.length === 0 && (
        <p className="stats__empty">
          Nenhum{noun === "perícia" ? "a" : ""} {noun} ainda.
        </p>
      )}
      {/* div, e não form: este editor também é usado dentro do formulário de criação */}
      <div className="stats__add">
        <input
          className="ink-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={variant === "boxes" ? "Ex.: Vigor" : "Ex.: Furtividade"}
          aria-label={`Nome d${noun === "perícia" ? "a" : "o"} ${noun}`}
          maxLength={40}
          onKeyDown={onEnter}
        />
        <button type="button" className="button button--ghost-ink" onClick={add}>
          Adicionar {noun}
        </button>
      </div>
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}
