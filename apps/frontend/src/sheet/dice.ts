/** Rolagens no formato NdM+K (ex.: "d20", "2d6+3", "1d8-1"). */

export interface DiceFormula {
  count: number;
  sides: number;
  bonus: number;
}

export interface RollResult {
  id: number;
  label: string;
  formula: DiceFormula;
  dice: number[];
  total: number;
}

const PATTERN = /^(\d{0,2})d(\d{1,4})([+-]\d{1,4})?$/;

export function parseFormula(text: string): DiceFormula | null {
  const match = PATTERN.exec(text.replace(/\s+/g, "").toLowerCase());
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  if (count < 1 || count > 20 || sides < 2 || sides > 1000) return null;
  return { count, sides, bonus: match[3] ? Number(match[3]) : 0 };
}

export function formatFormula({ count, sides, bonus }: DiceFormula): string {
  return `${count}d${sides}${bonus > 0 ? `+${bonus}` : bonus < 0 ? bonus : ""}`;
}

/** Sorteio sem viés, com o gerador criptográfico do navegador. */
export function rollDie(sides: number): number {
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return (buffer[0] % sides) + 1;
}

let nextId = 1;

export function roll(label: string, formula: DiceFormula): RollResult {
  const dice = Array.from({ length: formula.count }, () => rollDie(formula.sides));
  return { id: nextId++, label, formula, dice, total: dice.reduce((sum, value) => sum + value, 0) + formula.bonus };
}
