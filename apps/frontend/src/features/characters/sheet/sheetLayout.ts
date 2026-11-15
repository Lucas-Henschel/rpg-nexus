/** Operações nas colunas de blocos da ficha. Todas devolvem colunas novas e não mexem nas recebidas. */
import type { BlockType, SheetBlock } from "../api";
import { block } from "./templates";

export type Columns = SheetBlock[][];

function copy(columns: Columns): Columns {
  return columns.map((column) => [...column]);
}

export function patchBlock(
  columns: Columns,
  col: number,
  index: number,
  changes: Partial<SheetBlock>,
): Columns {
  const next = copy(columns);
  next[col][index] = { ...next[col][index], ...changes };

  return next;
}

/** Sobe (by = -1) ou desce (by = 1) o bloco dentro da coluna. */
export function moveBlock(columns: Columns, col: number, index: number, by: number): Columns {
  const next = copy(columns);
  const [moved] = next[col].splice(index, 1);
  next[col].splice(index + by, 0, moved);

  return next;
}

/** Leva o bloco para o fim da outra coluna. */
export function switchColumn(columns: Columns, col: number, index: number): Columns {
  const next = copy(columns);
  const [moved] = next[col].splice(index, 1);
  next[(col + 1) % next.length].push(moved);

  return next;
}

export function removeBlock(columns: Columns, col: number, index: number): Columns {
  const next = copy(columns);
  next[col].splice(index, 1);

  return next;
}

export function addBlock(columns: Columns, col: number, type: BlockType): Columns {
  const next = copy(columns);
  next[col].push(block(type));

  return next;
}
