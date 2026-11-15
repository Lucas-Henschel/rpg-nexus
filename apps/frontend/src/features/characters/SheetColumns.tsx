/** As duas colunas de blocos da ficha e o modo "Organizar ficha" (mover, remover e adicionar). */
import { useState } from "react";
import type { BlockType, Character, Hold } from "../../api/characters";
import { BLOCK_TITLES, SINGLETON_BLOCKS } from "../../sheet/templates";
import { SheetBlock } from "./SheetBlock";
import type { Draft } from "./sheetDraft";
import {
  addBlock,
  moveBlock,
  patchBlock,
  removeBlock,
  switchColumn,
  type Columns,
} from "./sheetLayout";

const BLOCK_MENU: { type: BlockType; hint: string }[] = [
  { type: "attributes", hint: "Caixas com os valores do personagem" },
  { type: "skills", hint: "Bônus que rolam com um d20" },
  { type: "hp", hint: "Barra de vida atual e máxima" },
  { type: "backpack", hint: "Espaços e itens pedidos na campanha" },
  { type: "counter", hint: "Mana, sanidade, munição, o que acabar" },
  { type: "dice", hint: "Rolagens com nome, prontas para clicar" },
  { type: "list", hint: "Magias, equipamento, pistas" },
  { type: "text", hint: "Texto livre" },
];

interface MenuProps {
  open: boolean;
  onToggle: () => void;
  /** Tipos de bloco único que já estão na ficha e não podem entrar de novo. */
  taken: Set<BlockType>;
  onAdd: (type: BlockType) => void;
}

function AddBlockMenu({ open, onToggle, taken, onAdd }: MenuProps) {
  return (
    <div className="add-block">
      <button type="button" className="add-block__button" onClick={onToggle} aria-expanded={open}>
        Adicionar bloco
      </button>
      {open && (
        <ul className="add-block__menu">
          {BLOCK_MENU.map(({ type, hint }) => (
            <li key={type}>
              <button type="button" disabled={taken.has(type)} onClick={() => onAdd(type)}>
                <strong>{BLOCK_TITLES[type]}</strong>
                <span>{taken.has(type) ? "Já está na ficha" : hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  draft: Draft;
  edit: (changes: Partial<Draft>) => void;
  character: Character;
  holds: Hold[];
}

export function SheetColumns({ draft, edit, character, holds }: Props) {
  const [organizing, setOrganizing] = useState(false);
  const [menuAt, setMenuAt] = useState<number | null>(null);

  const columns = draft.sheet.columns;
  const setColumns = (next: Columns) => edit({ sheet: { ...draft.sheet, columns: next } });
  // Ficha sem nenhum bloco: as ferramentas ficam abertas, senão não haveria o que clicar.
  const showTools = organizing || columns.every((column) => column.length === 0);
  const taken = new Set(
    columns
      .flat()
      .map((b) => b.type)
      .filter((type) => SINGLETON_BLOCKS.includes(type)),
  );

  return (
    <>
      <div className="sheet__toolbar">
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setOrganizing(!showTools);
            setMenuAt(null);
          }}
        >
          {showTools ? "Concluir organização" : "Organizar ficha"}
        </button>
      </div>

      <div className="sheet__columns">
        {columns.map((column, col) => (
          <div key={col} className="sheet__column">
            {column.map((item, index) => (
              <SheetBlock
                key={item.id}
                item={item}
                draft={draft}
                edit={edit}
                character={character}
                holds={holds}
                onPatch={(changes) => setColumns(patchBlock(columns, col, index, changes))}
                actions={
                  showTools
                    ? {
                        canMoveUp: index > 0,
                        canMoveDown: index < column.length - 1,
                        onMove: (by) => setColumns(moveBlock(columns, col, index, by)),
                        onSwitchColumn: () => setColumns(switchColumn(columns, col, index)),
                        onRemove: () => setColumns(removeBlock(columns, col, index)),
                      }
                    : null
                }
              />
            ))}

            {column.length === 0 && !showTools && <p className="stats__empty">Coluna vazia.</p>}

            {showTools && (
              <AddBlockMenu
                open={menuAt === col}
                onToggle={() => setMenuAt(menuAt === col ? null : col)}
                taken={taken}
                onAdd={(type) => {
                  setColumns(addBlock(columns, col, type));
                  setMenuAt(null);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );
}
