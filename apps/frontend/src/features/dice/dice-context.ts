import { createContext, useContext } from "react";
import type { DiceFormula } from "./dice";

export type RollDice = (label: string, formula: string | DiceFormula) => void;

export const DiceContext = createContext<RollDice>(() => {});

export function useDice(): RollDice {
  return useContext(DiceContext);
}
