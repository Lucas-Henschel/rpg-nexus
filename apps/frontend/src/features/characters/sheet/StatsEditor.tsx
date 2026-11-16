import { useState } from "react";
import type { StatMap } from "../api";
import { signed, toKey, toLabel } from "../../../shared/labels";
import { DieIcon } from "../../dice/DiceTray";
import { onEnter } from "../../../shared/ui/onEnter";
import { useDice } from "../../dice/dice-context";
import { parseFormula } from "../../dice/dice";

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
  editing?: boolean;
  diceFormulas?: Record<string, string>;
  diceSides?: Record<string, number>;
  skillLabels?: Record<string, string>;
  onSkillChange?: (oldKey: string, next: { key: string; label: string; formula: string } | null) => void;
}

export function StatsEditor({ kind, stats, onChange, min = -1000, max = 1000, editing = true, diceFormulas = {}, diceSides = {}, skillLabels = {}, onSkillChange }: Props) {
  const rollDice = useDice();
  const { start, placeholder, text } = KINDS[kind];
  const [name, setName] = useState("");
  const [problem, setProblem] = useState("");
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [skillName, setSkillName] = useState("");
  const [skillFormula, setSkillFormula] = useState("");
  const [skillProblem, setSkillProblem] = useState("");
  const entries = Object.entries(stats);
  const formulaFor = (key: string, value: number) => diceFormulas[key] || `1d${diceSides[key] ?? 20}${value === 0 ? "" : signed(value)}`;
  const skillLabel = (key: string) => skillLabels[key] || toLabel(key);

  const openSkill = (key: string, value: number) => {
    if (editingSkill === key) return setEditingSkill(null);
    setEditingSkill(key);
    setSkillName(skillLabel(key));
    setSkillFormula(formulaFor(key, value));
    setSkillProblem("");
  };
  const saveSkill = (oldKey: string) => {
    const key = toKey(skillName);
    if (!key) return setSkillProblem("Informe um nome para a perícia.");
    if (key !== oldKey && key in stats) return setSkillProblem("Já existe uma perícia com esse nome.");
    if (!parseFormula(skillFormula)) return setSkillProblem("Escreva uma rolagem como 2d20+5.");
    onSkillChange?.(oldKey, { key, label: skillName.trim(), formula: skillFormula.trim() });
    setEditingSkill(null);
    setSkillProblem("");
  };

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
              <output className="stat-box__value">{value}</output>
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
              {editing && <button
                type="button"
                className="stat-box__remove"
                onClick={() => remove(key)}
                aria-label={`Remover ${toLabel(key)}`}
              >
                ×
              </button>}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="stat-rows">
          {entries.map(([key, value]) => (
            <li key={key} className={`stat-row${editing || editingSkill === key ? " stat-row--layout" : ""}`}>
              <span className="stat-row__name">{skillLabel(key)}</span>
              <span className="stat-row__dots" aria-hidden="true" />
              {kind === "skills" && (
                <button
                  type="button"
                  className="roll-button"
                  onClick={() => rollDice(skillLabel(key), formulaFor(key, value))}
                  aria-label={`Rolar ${skillLabel(key)}: ${formulaFor(key, value)}`}
                >
                  <DieIcon sides={parseFormula(formulaFor(key, value))?.sides ?? 20} />
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
              <button type="button" className="stat-row__edit" onClick={() => openSkill(key, value)}
                aria-label={`Editar perícia ${skillLabel(key)}`} aria-expanded={editingSkill === key}>✎</button>
              {editingSkill === key && <div className="stat-row__editor">
                <label>Nome <input className="ink-input" value={skillName} maxLength={40}
                  onChange={event => setSkillName(event.target.value)} aria-label={`Nome de ${skillLabel(key)}`} /></label>
                <label>Rolagem <input className="ink-input" value={skillFormula} maxLength={12}
                  onChange={event => setSkillFormula(event.target.value)} aria-label={`Rolagem de ${skillLabel(key)}`} placeholder="2d20+5" /></label>
                {skillProblem && <p className="field-error">{skillProblem}</p>}
                <div className="stat-row__editor-actions">
                  <button type="button" className="button button--ghost-ink button--small" onClick={() => saveSkill(key)}>Aplicar</button>
                  <button type="button" className="button button--ghost-ink button--small" onClick={() => setEditingSkill(null)}>Cancelar</button>
                  <button type="button" className="button button--ghost-ink button--small" onClick={() => { onSkillChange?.(key, null); setEditingSkill(null); }}>Remover perícia</button>
                </div>
              </div>}
            </li>
          ))}
        </ul>
      )}
      {entries.length === 0 && <p className="stats__empty">{text.empty}</p>}
      {/* div, e não form: este editor também é usado dentro do formulário de criação */}
      {editing && <div className="stats__add">
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
      </div>}
      {problem && <p className="field-error">{problem}</p>}
    </div>
  );
}
