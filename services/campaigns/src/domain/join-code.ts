import { randomInt } from "node:crypto";

/** Seis algarismos sorteados, com zeros à esquerda (000000 a 999999). */
export function randomJoinCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
