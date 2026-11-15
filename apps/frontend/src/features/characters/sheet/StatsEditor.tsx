import { useState } from "react";
import type { StatMap } from "../api";
import { signed, toKey, toLabel } from "../../../shared/labels";
import { DieIcon } from "../../dice/DiceTray";
import { onEnter } from "../../../shared/ui/onEnter";

type Kind = "attributes" | "skills";

/** Atributos aparecem em caixas e começam em 10; perícias em linhas pontilhadas e começam em 0. */
const KINDS: Record<Kind, { start: number; placeholder: string; text: Record<string, string> }> = {
  attributes: {
    start: 10,
    placeholder: "Ex.: Vigor",
    text: {
      missing: "Dê um nome para o atributo, começando por uma letra.",
      empty: "Nenhum atributo ainda.",
      name: "Nome do atributo",
      add: "Adicionar atributo",
    },
  },
  skills: {
    start: 0,
    placeholder: "Ex.: Furtividade",
    text: {
      missing: "Dê um nome para a perícia, começando por uma letra.",
      empty: "Nenhuma perícia ainda.",
      name: "Nome da perícia",
      add: "Adicionar perícia",
    },
  },
};

interface Props {
  kind: Kind;
  stats: StatMap;
  onChange: (next: StatMap) => void;
  min?: number;
  max?: number;
  /** Se informado, cada linha ganha um botão de rolagem (usado nas perícias: d20 + valor). */
  onRoll?: (key: string, value: number) => void;
}

export function StatsEditor({ kind, stats, onChange, min = -1000, max = 1000, onRoll }: Props) {
  const { start, placeholder, text } = KINDS[kind];
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const entries = Object.entries(stats);

  const set = (key: string, value: number) => {
    if (Number.isNaN(value)) {
      return;
    }

    onChange({ ...stats, [key]: Math.max(min, Math.min(max, Math.trunc(value))) });
  };

  const remove = (key: string) => {
    const next = { ...stats };
    delete next[key];
    onChange(next);
  };

  const add = () => {
    const key = toKey(name);
    if (!key) {
      return setProblem(text.missing);
    }

    if (key in stats) {
      return setProblem(`${toLabel(key)} já está na ficha.`);
    }

    if (entries.length >= 64) {
      return setProblem("A ficha comporta até 64 entradas.");
    }

    onChange({ ...stats, [key]: start });
    setName("");
    setProblem("");
  };

  return (
    <div className="stats">
      {kind === "attributes" ? (
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
      {entries.length === 0 && <p className="stats__empty">{text.empty}</p>}
      {/* div, e não form: este editor também é usado dentro do formulário de criação */}
      <div className="stats__add">
        <input
          className="ink-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          aria-label={text.name}
          maxLength={40}
          onKeyDown={onEnter(add)}
        />
        <button type="button" className="button button--ghost-ink" onClick={add}>
          {text.add}
        </button>
      </div>
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}
