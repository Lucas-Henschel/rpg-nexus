/** Um bloco da ficha: cabeçalho com título e ferramentas de organização, e o conteúdo do tipo dele. */
import type { Character, Hold, SheetBlock as Block } from "../api";
import type { InventoryEntry, ShopItem } from "../../inventory/api";
import { StatsEditor } from "./StatsEditor";
import { BLOCK_TITLES, SINGLETON_BLOCKS } from "./templates";
import { CounterBlock, DiceBlock, ListBlock, TextBlock } from "./FreeBlocks";
import type { Draft } from "./sheetDraft";
import { HpBlock } from "./VitalBlocks";
import { BackpackBlock } from "./BackpackBlock";

const FREE_BLOCKS = { counter: CounterBlock, dice: DiceBlock, list: ListBlock, text: TextBlock };

interface BodyProps {
  item: Block;
  draft: Draft;
  edit: (changes: Partial<Draft>) => void;
  character: Character;
  holds: Hold[];
  inventory: InventoryEntry[];
  shopItems: ShopItem[];
  onData: (data: Record<string, unknown>) => void;
  editing: boolean;
}

function BlockBody({ item, draft, edit, character, holds, inventory, shopItems, onData, editing }: BodyProps) {
  switch (item.type) {
    case "hp":
      return <HpBlock current={draft.hpCurrent} max={draft.hpMax} onChange={edit} data={item.data} onData={onData} editing={editing} />;
    case "backpack":
      return (
        <BackpackBlock
          maxItems={draft.maxItems}
          slotsUsed={character.capacity.slotsUsed}
          holds={holds}
          inventory={inventory}
          shopItems={shopItems}
          onChange={(maxItems) => edit({ maxItems })}
          data={item.data} onData={onData} editing={editing}
        />
      );
    case "attributes":
      return (
        <StatsEditor
          kind="attributes"
          stats={draft.attributes}
          onChange={(attributes) => edit({ attributes })}
          editing={editing}
        />
      );
    case "skills":
      return (
        <StatsEditor
          kind="skills"
          stats={draft.skills}
          onChange={(skills) => edit({ skills })}
          editing={editing}
          diceFormulas={item.data.diceFormulas as Record<string, string> | undefined}
          diceSides={item.data.diceSides as Record<string, number> | undefined}
          skillLabels={item.data.skillLabels as Record<string, string> | undefined}
          onSkillChange={(oldKey, next) => {
            const skills: Record<string, number> = {};
            for (const [key, value] of Object.entries(draft.skills)) {
              if (key === oldKey) {
                if (next) skills[next.key] = value;
              } else skills[key] = value;
            }
            const diceFormulas = { ...(item.data.diceFormulas as Record<string, string> | undefined) };
            const diceSides = { ...(item.data.diceSides as Record<string, number> | undefined) };
            const skillLabels = { ...(item.data.skillLabels as Record<string, string> | undefined) };
            delete diceFormulas[oldKey];
            delete diceSides[oldKey];
            delete skillLabels[oldKey];
            if (next) {
              diceFormulas[next.key] = next.formula;
              skillLabels[next.key] = next.label;
            }
            edit({ skills });
            onData({ ...item.data, diceFormulas, diceSides, skillLabels });
          }}
        />
      );
    default: {
      const Free = FREE_BLOCKS[item.type];

      return <Free title={item.title} data={item.data} onChange={onData} editing={editing} />;
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
        {free && body.editing ? (
          <input
            className="block__title block__title--input"
            value={item.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            placeholder={BLOCK_TITLES[item.type]}
            aria-label="Título do bloco"
            maxLength={80}
          />
        ) : (
          <h2 className="block__title">{free ? item.title || BLOCK_TITLES[item.type] : BLOCK_TITLES[item.type]}</h2>
        )}
        {actions && <BlockTools {...actions} />}
      </header>
      <BlockBody item={item} onData={(data) => onPatch({ data })} {...body} />
    </section>
  );
}
