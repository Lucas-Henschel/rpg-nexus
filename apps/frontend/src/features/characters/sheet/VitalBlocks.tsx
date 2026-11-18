import { useState } from "react";

type Data = Record<string, unknown>;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0;
const tint = (v: unknown, fallback: string) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;

export function ResourceMeter({ current, max, color, title, onCurrent, onMax, minMax = 0, allowOverflow = false }: {
  current: number; max: number; color: string; title: string;
  onCurrent: (value: number) => void; onMax: (value: number) => void; minMax?: number; allowOverflow?: boolean;
}) {
  const [editingValue, setEditingValue] = useState<"current" | "max" | null>(null);
  const [typed, setTyped] = useState("");
  const begin = (target: "current" | "max") => { setTyped(String(target === "current" ? current : max)); setEditingValue(target); };
  const commit = () => {
    const value = Number(typed.replace(",", "."));
    if (typed.trim() && Number.isFinite(value)) {
      if (editingValue === "max") onMax(Math.max(minMax, value));
      else onCurrent(Math.max(0, allowOverflow ? value : Math.min(max, value)));
    }
    setEditingValue(null);
  };
  const change = (amount: number) => onCurrent(Math.max(0, allowOverflow ? current + amount : Math.min(max, current + amount)));
  const buttons = [
    { text: "<<", amount: -5 }, { text: "<", amount: -1 },
    { text: ">", amount: 1 }, { text: ">>", amount: 5 },
  ];
  return <div className="resource-meter" aria-label={`${title}: ${current} de ${max}`}>
    <div className="resource-meter__fill" style={{ width: `${max > 0 ? Math.min(100, current / max * 100) : 0}%`, backgroundColor: color }} />
    <div className="resource-meter__controls">
      {buttons.slice(0, 2).map(button => <button key={button.text} type="button" onClick={() => change(button.amount)} aria-label={`${title}: ${button.amount} pontos`}>{button.text}</button>)}
      <div className="resource-meter__numbers">
        {(["current", "max"] as const).map((part, index) => <span key={part}>
          {index === 1 && <span aria-hidden="true">/</span>}
          {editingValue === part ? <input autoFocus inputMode="decimal" aria-label={`${title}: ${part === "current" ? "valor atual" : "valor máximo"}`}
            value={typed} onChange={e => setTyped(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditingValue(null); }} /> :
            <button type="button" className="resource-meter__number" onClick={() => begin(part)}
              aria-label={`Editar ${part === "current" ? "valor atual" : "valor máximo"} de ${title}`}>{part === "current" ? current : max}</button>}
        </span>)}
      </div>
      {buttons.slice(2).map(button => <button key={button.text} type="button" onClick={() => change(button.amount)} aria-label={`${title}: +${button.amount} pontos`}>{button.text}</button>)}
    </div>
  </div>;
}

export function ResourceOptions({ data, onChange, fallback }: { data: Data; onChange: (data: Data) => void; fallback: string }) {
  return <div className="resource-options">
    <label>Cor <input type="color" value={tint(data.color, fallback)} onChange={e => onChange({ ...data, color: e.target.value })} /></label>
    <label><input type="checkbox" checked={data.allowOverflow === true} onChange={e => onChange({ ...data, allowOverflow: e.target.checked })} /> Permitir passar do máximo</label>
  </div>;
}

export function HpBlock({ current, max, onChange, data, onData, editing }: {
  current: number; max: number; onChange: (hp: { hpCurrent?: number; hpMax?: number }) => void;
  data: Data; onData: (data: Data) => void; editing: boolean;
}) {
  const extra = Math.max(0, num(data.temporary));
  const total = current + extra;
  const overflow = data.allowOverflow === true;
  const setTotal = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = Math.max(0, overflow ? value : Math.min(max, value));
    const base = Math.min(Math.floor(next), max);
    onChange({ hpCurrent: base });
    onData({ ...data, temporary: Math.max(0, next - base) });
  };
  const setMax = (value: number) => {
    if (!Number.isFinite(value)) return;
    const next = Math.max(1, Math.trunc(value));
    onChange({ hpMax: next, hpCurrent: Math.min(current, next) });
    onData({ ...data, temporary: overflow ? Math.max(0, total - Math.min(current, next)) : Math.max(0, Math.min(total, next) - Math.min(current, next)) });
  };
  return <div className="vital">
    <ResourceMeter current={total} max={max} color={tint(data.color, "#aa3035")} title="Vida"
      onCurrent={setTotal} onMax={setMax} minMax={1} allowOverflow={overflow} />
    {editing && <ResourceOptions data={data} onChange={(next) => {
      if (next.allowOverflow !== true && total > max) { onChange({ hpCurrent: max }); onData({ ...next, temporary: 0 }); }
      else onData(next);
    }} fallback="#aa3035" />}
  </div>;
}
