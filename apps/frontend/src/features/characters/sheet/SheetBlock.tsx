/** Um bloco da ficha: cabeçalho com título e ferramentas de organização, e o conteúdo do tipo dele. */
import type { Character, Hold, SheetBlock as Block } from "../api";
import { useDice } from "../../dice/dice-context";
import { StatsEditor } from "./StatsEditor";
import { toLabel } from "../../../shared/labels";
import { BLOCK_TITLES, SINGLETON_BLOCKS } from "./templates";
import { CounterBlock, DiceBlock, ListBlock, TextBlock } from "./FreeBlocks";
import type { Draft } from "./sheetDraft";
import { BackpackBlock, HpBlock } from "./VitalBlocks";

const FREE_BLOCKS = { counter: CounterBlock, dice: DiceBlock, list: ListBlock, text: TextBlock };

interface BodyProps {
  item: Block;
  draft: Draft;
  edit: (changes: Partial<Draft>) => void;
  character: Character;
  holds: Hold[];
  onData: (data: Record<string, unknown>) => void;
}

function BlockBody({ item, draft, edit, character, holds, onData }: BodyProps) {
  const rollDice = useDice();
  switch (item.type) {
    case "hp":
      return <HpBlock current={draft.hpCurrent} max={draft.hpMax} onChange={edit} />;
    case "backpack":
      return (
        <BackpackBlock
          maxItems={draft.maxItems}
          slotsUsed={character.capacity.slotsUsed}
          holds={holds}
          onChange={(maxItems) => edit({ maxItems })}
        />
      );
    case "attributes":
      return (
        <StatsEditor
          kind="attributes"
          stats={draft.attributes}
          onChange={(attributes) => edit({ attributes })}
        />
      );
    case "skills":
      return (
        <StatsEditor
          kind="skills"
          stats={draft.skills}
          onChange={(skills) => edit({ skills })}
          onRoll={(key, value) => rollDice(toLabel(key), { count: 1, sides: 20, bonus: value })}
        />
      );
    default: {
      const Free = FREE_BLOCKS[item.type];
      return <Free title={item.title} data={item.data} onChange={onData} />;
    }
  }
}

/** Botões que aparecem no modo "Organizar ficha". */
export interface BlockActions {
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (by: number) => void;
  onSwitchColumn: () => void;
  onRemove: () => void;
}

function BlockTools({ canMoveUp, canMoveDown, onMove, onSwitchColumn, onRemove }: BlockActions) {
  return (
    <span className="block__tools">
      <button
        type="button"
        onClick={() => onMove(-1)}
        disabled={!canMoveUp}
        aria-label="Mover bloco para cima"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => onMove(1)}
        disabled={!canMoveDown}
        aria-label="Mover bloco para baixo"
      >
        ↓
      </button>
      <button type="button" onClick={onSwitchColumn} aria-label="Mover bloco para a outra coluna">
        ⇄
      </button>
      <button type="button" onClick={onRemove} aria-label="Remover bloco">
        ×
      </button>
    </span>
  );
}

interface Props extends Omit<BodyProps, "onData"> {
  /** null fora do modo de organização. */
  actions: BlockActions | null;
  onPatch: (changes: Partial<Block>) => void;
}

export function SheetBlock({ item, actions, onPatch, ...body }: Props) {
  // Blocos livres têm título editável; os ligados a campos fixos usam o nome do tipo.
  const free = !SINGLETON_BLOCKS.includes(item.type);
  return (
    <section className="block">
      <header className="block__head">
        {free ? (
          <input
            className="block__title block__title--input"
            value={item.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            placeholder={BLOCK_TITLES[item.type]}
            aria-label="Título do bloco"
            maxLength={80}
          />
        ) : (
          <h2 className="block__title">{BLOCK_TITLES[item.type]}</h2>
        )}
        {actions && <BlockTools {...actions} />}
      </header>
      <BlockBody item={item} onData={(data) => onPatch({ data })} {...body} />
    </section>
  );
}
