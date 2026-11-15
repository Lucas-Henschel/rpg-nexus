/** Blocos livres da ficha: o conteúdo de cada um fica em block.data e é salvo junto com a ficha. */
import { useState, type KeyboardEvent } from "react";
import { useDice } from "../../components/dice-context";
import { DieIcon } from "../../components/DiceTray";
import { parseFormula } from "../../sheet/dice";

type Data = Record<string, unknown>;
interface Props {
  title: string;
  data: Data;
  onChange: (data: Data) => void;
}

const asNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asString = (value: unknown) => (typeof value === "string" ? value : "");

function onEnter(action: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    action();
  };
}

export function TextBlock({ data, onChange }: Props) {
  const body = asString(data.body);
  return (
    <textarea
      className="ink-input block-text"
      rows={Math.max(3, body.split("\n").length + 1)}
      value={body}
      onChange={(e) => onChange({ body: e.target.value })}
      placeholder="Escreva aqui"
      aria-label="Texto"
      maxLength={8000}
    />
  );
}

export function CounterBlock({ title, data, onChange }: Props) {
  const max = Math.max(0, asNumber(data.max, 0));
  const current = Math.max(0, asNumber(data.current, 0));
  const set = (next: number, nextMax = max) => {
    if (Number.isNaN(next) || Number.isNaN(nextMax)) return;
    const safeMax = Math.max(0, Math.min(9999, Math.trunc(nextMax)));
    onChange({ current: Math.max(0, Math.min(safeMax, Math.trunc(next))), max: safeMax });
  };
  return (
    <div className="counter">
      <div
        className="counter__bar"
        role="img"
        aria-label={`${title || "Contador"}: ${current} de ${max}`}
      >
        <div
          className="counter__fill"
          style={{ width: `${max > 0 ? (current / max) * 100 : 0}%` }}
        />
      </div>
      <div className="vital__row">
        <button
          type="button"
          className="round-step"
          onClick={() => set(current - 1)}
          aria-label="Diminuir 1"
        >
          −
        </button>
        <input
          className="ink-input ink-input--number"
          type="number"
          min={0}
          value={current}
          onChange={(e) => set(e.target.valueAsNumber)}
          aria-label="Valor atual"
        />
        <span>de</span>
        <input
          className="ink-input ink-input--number"
          type="number"
          min={0}
          value={max}
          onChange={(e) => set(current, e.target.valueAsNumber)}
          aria-label="Valor máximo"
        />
        <button
          type="button"
          className="round-step"
          onClick={() => set(current + 1)}
          aria-label="Aumentar 1"
        >
          +
        </button>
      </div>
    </div>
  );
}

export function ListBlock({ data, onChange }: Props) {
  const items = Array.isArray(data.items)
    ? data.items.filter((item): item is string => typeof item === "string")
    : [];
  const [text, setText] = useState("");
  const add = () => {
    const value = text.trim();
    if (!value || items.length >= 100) return;
    onChange({ items: [...items, value] });
    setText("");
  };
  return (
    <div>
      {items.length > 0 && (
        <ul className="block-list">
          {items.map((item, index) => (
            <li key={`${index}-${item}`}>
              <span>{item}</span>
              <button
                type="button"
                className="stat-row__remove"
                onClick={() => onChange({ items: items.filter((_, i) => i !== index) })}
                aria-label={`Remover ${item}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="stats__add">
        <input
          className="ink-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onEnter(add)}
          placeholder="Novo item da lista"
          aria-label="Novo item da lista"
          maxLength={120}
        />
        <button type="button" className="button button--ghost-ink" onClick={add}>
          Adicionar
        </button>
      </div>
    </div>
  );
}

interface NamedRoll {
  label: string;
  expr: string;
}

export function DiceBlock({ data, onChange }: Props) {
  const rollDice = useDice();
  const rolls: NamedRoll[] = Array.isArray(data.rolls)
    ? data.rolls.flatMap((entry) => {
        const item = entry as Partial<NamedRoll> | null;
        return item && typeof item.label === "string" && typeof item.expr === "string"
          ? [{ label: item.label, expr: item.expr }]
          : [];
      })
    : [];
  const [label, setLabel] = useState("");
  const [expr, setExpr] = useState("");
  const [problem, setProblem] = useState("");

  const add = () => {
    if (!label.trim()) return setProblem("Dê um nome para a rolagem.");
    if (!parseFormula(expr)) return setProblem("Escreva os dados como d20, 2d6+3 ou 1d8-1.");
    if (rolls.length >= 30) return setProblem("Cada bloco comporta até 30 rolagens.");
    onChange({
      rolls: [...rolls, { label: label.trim(), expr: expr.replace(/\s+/g, "").toLowerCase() }],
    });
    setLabel("");
    setExpr("");
    setProblem("");
  };

  return (
    <div>
      {rolls.length > 0 && (
        <ul className="stat-rows">
          {rolls.map((item, index) => (
            <li key={`${index}-${item.label}`} className="stat-row">
              <span className="stat-row__name">{item.label}</span>
              <span className="stat-row__dots" aria-hidden="true" />
              <span className="roll-formula">{item.expr}</span>
              <button
                type="button"
                className="roll-button roll-button--text"
                onClick={() => rollDice(item.label, item.expr)}
              >
                <DieIcon sides={20} />
                Rolar
              </button>
              <button
                type="button"
                className="stat-row__remove"
                onClick={() => onChange({ rolls: rolls.filter((_, i) => i !== index) })}
                aria-label={`Remover ${item.label}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="stats__add stats__add--roll">
        <input
          className="ink-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={onEnter(add)}
          placeholder="Ex.: Ataque de espada"
          aria-label="Nome da rolagem"
          maxLength={60}
        />
        <input
          className="ink-input roll-input"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          onKeyDown={onEnter(add)}
          placeholder="1d20+5"
          aria-label="Dados da rolagem"
          maxLength={12}
          spellCheck={false}
        />
        <button type="button" className="button button--ghost-ink" onClick={add}>
          Adicionar
        </button>
      </div>
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}
