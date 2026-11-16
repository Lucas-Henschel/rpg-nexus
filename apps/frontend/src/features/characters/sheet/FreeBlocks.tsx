/** Blocos livres da ficha: o conteúdo de cada um fica em block.data e é salvo junto com a ficha. */
import { useState } from "react";
import { useDice } from "../../dice/dice-context";
import { DieIcon } from "../../dice/DiceTray";
import { onEnter } from "../../../shared/ui/onEnter";
import { parseFormula } from "../../dice/dice";
import { ResourceMeter, ResourceOptions } from "./VitalBlocks";

type Data = Record<string, unknown>;
interface Props {
  title: string;
  data: Data;
  onChange: (data: Data) => void;
  editing: boolean;
}

const asNumber = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asString = (value: unknown) => (typeof value === "string" ? value : "");

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

export function CounterBlock({ title, data, onChange, editing }: Props) {
  const max = Math.max(0, asNumber(data.max, 0));
  const current = Math.max(0, asNumber(data.current, 0));
  const overflow = data.allowOverflow === true;
  const set = (next: number, nextMax = max) => {
    if (Number.isNaN(next) || Number.isNaN(nextMax)) {
      return;
    }

    const safeMax = Math.max(0, Math.min(9999, nextMax));
    onChange({ ...data, current: Math.max(0, overflow ? next : Math.min(safeMax, next)), max: safeMax });
  };

  return (
    <div className="counter">
      <ResourceMeter title={title} current={current} max={max} color={asString(data.color) || "#7449a0"}
        onCurrent={value => set(value)} onMax={value => set(current, value)} allowOverflow={overflow} />
      {editing && <ResourceOptions data={data} onChange={(next) => onChange({ ...next, current: next.allowOverflow === true ? current : Math.min(current, max) })} fallback="#7449a0" />}
    </div>
  );
}

interface ListEntry { name: string; description?: string; roll?: string }
export function ListBlock({ data, onChange }: Props) {
  const rollDice = useDice();
  const items: ListEntry[] = Array.isArray(data.items) ? data.items.flatMap((item) =>
    typeof item === "string" ? [{ name: item }] : item && typeof item === "object" && typeof item.name === "string" ? [item as ListEntry] : []) : [];
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [formula, setFormula] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const updateItem = (index: number, changes: Partial<ListEntry>) => onChange({ items: items.map((item, i) => i === index ? { ...item, ...changes } : item) });
  const add = () => {
    const value = text.trim();
    if (!value || items.length >= 100) {
      return;
    }

    if (formula.trim() && !parseFormula(formula)) return;
    onChange({ items: [...items, { name: value, description: description.trim(), roll: formula.trim() }] });
    setText("");
    setDescription("");
    setFormula("");
    setAdding(false);
  };

  return (
    <div>
      {items.length > 0 && (
        <ul className="block-list">
          {items.map((item, index) => (
            <li key={`${index}-${item.name}`} className="list-entry">
              <button type="button" className="text-button" onClick={() => setExpanded(expanded === index ? null : index)} aria-expanded={expanded === index}>{item.name}</button>
              {item.roll && <button type="button" className="roll-button roll-button--text" onClick={() => rollDice(item.name, item.roll!)}><DieIcon sides={20} /> Rolar</button>}
              {expanded === index && <div className="list-entry__details">
                <input className="ink-input" aria-label="Nome na lista" value={item.name} onChange={e => updateItem(index, { name: e.target.value })} />
                <textarea className="ink-input" aria-label="Descrição na lista" value={item.description ?? ""} onChange={e => updateItem(index, { description: e.target.value })} placeholder="Descrição" />
                <input className="ink-input" aria-label="Rolagem na lista" value={item.roll ?? ""} onChange={e => updateItem(index, { roll: e.target.value })} placeholder="Rolagem opcional" />
              </div>}
              {expanded !== index && item.description && <p className="list-entry__description">{item.description}</p>}
              <button
                type="button"
                className="list-entry__remove"
                onClick={() => onChange({ items: items.filter((_, i) => i !== index) })}
                aria-label={`Remover ${item.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {!adding ? <button type="button" className="button button--ghost-ink list-entry__toggle"
        onClick={() => setAdding(true)} aria-expanded={false}>+ Adicionar item</button> : <div className="list-entry__add">
        <input
          className="ink-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onEnter(add)}
          placeholder="Novo item da lista"
          aria-label="Novo item da lista"
          maxLength={120}
        />
        <textarea className="ink-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição opcional" aria-label="Descrição do item" maxLength={1000} />
        <input className="ink-input" value={formula} onChange={e => setFormula(e.target.value)} placeholder="Rolagem opcional, ex.: 1d20+2" aria-label="Rolagem do item" />
        <button type="button" className="button button--ghost-ink" onClick={add}>
          Adicionar
        </button>
        <button type="button" className="text-button" onClick={() => setAdding(false)}>Cancelar</button>
      </div>}
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
    if (!label.trim()) {
      return setProblem("Dê um nome para a rolagem.");
    }

    if (!parseFormula(expr)) {
      return setProblem("Escreva os dados como d20, 2d6+3 ou 1d8-1.");
    }

    if (rolls.length >= 30) {
      return setProblem("Cada bloco comporta até 30 rolagens.");
    }

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
              <input className="ink-input roll-input" aria-label={`Fórmula de ${item.label}`} value={item.expr}
                onChange={event => onChange({ ...data, rolls: rolls.map((roll, i) => i === index ? { ...roll, expr: event.target.value } : roll) })} />
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
