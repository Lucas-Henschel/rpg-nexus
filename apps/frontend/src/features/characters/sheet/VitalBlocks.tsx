/** Blocos ligados a campos fixos do personagem: pontos de vida e mochila. */
import type { Hold } from "../api";
import { CurrentOfMax } from "../../../shared/ui/CurrentOfMax";
import { Backpack, HpBar } from "../../../shared/ui/Sheet";

const HP_LABELS = {
  less: "Tirar 1 ponto de vida",
  more: "Devolver 1 ponto de vida",
  current: "Pontos de vida atuais",
  max: "Pontos de vida máximos",
};

interface HpProps {
  current: number;
  max: number;
  onChange: (hp: { hpCurrent?: number; hpMax?: number }) => void;
}

export function HpBlock({ current, max, onChange }: HpProps) {
  return (
    <div className="vital">
      <HpBar current={current} max={max} />
      <CurrentOfMax
        current={current}
        max={max}
        minMax={1}
        onCurrent={(hpCurrent) => onChange({ hpCurrent })}
        onMax={(hpMax) => onChange({ hpMax })}
        labels={HP_LABELS}
      />
    </div>
  );
}

const HOLD_TEXT: Record<Hold["status"], string> = {
  HELD: "Reservado, aguardando o resultado",
  COMMITTED: "Entregue",
  RELEASED: "Cancelado, espaço devolvido",
};

interface BackpackProps {
  maxItems: number;
  /** Espaços ocupados segundo o serviço: itens entregues mais reservas em andamento. */
  slotsUsed: number;
  holds: Hold[];
  onChange: (maxItems: number) => void;
}

export function BackpackBlock({ maxItems, slotsUsed, holds, onChange }: BackpackProps) {
  const reserved = holds
    .filter((hold) => hold.status === "HELD")
    .reduce((sum, hold) => sum + hold.quantity, 0);

  return (
    <div className="vital">
      <Backpack
        // o campo vazio vira NaN enquanto a pessoa digita
        maxItems={maxItems >= 0 ? maxItems : 0}
        delivered={Math.max(slotsUsed - reserved, 0)}
        reserved={reserved}
      />
      <label className="vital__row">
        <span>Espaços</span>
        <input
          className="ink-input ink-input--number"
          type="number"
          min={0}
          max={1000}
          value={maxItems}
          onChange={(e) => onChange(e.target.valueAsNumber)}
        />
      </label>
      {holds.length > 0 && (
        <ul className="holds">
          {holds.map((hold) => (
            <li key={hold.operationId} className={`hold hold--${hold.status.toLowerCase()}`}>
              <span className="hold__item">{hold.itemId ?? "Item"}</span>
              <span className="hold__status">{HOLD_TEXT[hold.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
