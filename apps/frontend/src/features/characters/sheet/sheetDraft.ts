/** Rascunho da ficha em edição: de onde ele nasce, o que vai no PATCH e quando pode ser salvo. */
import type { Character, CharacterPatch, Sheet, StatMap } from "../api";
import { normalizeSheet } from "./templates";
import { parseFormula } from "../../dice/dice";

export interface Draft {
  name: string;
  description: string;
  hpCurrent: number;
  hpMax: number;
  maxItems: number;
  active: boolean;
  attributes: StatMap;
  skills: StatMap;
  sheet: Sheet;
}

export function toDraft(c: Character): Draft {
  return {
    name: c.name,
    description: c.description ?? "",
    hpCurrent: c.hp.current,
    hpMax: c.hp.max,
    maxItems: c.capacity.maxItems,
    active: c.active,
    attributes: { ...c.attributes },
    skills: { ...c.skills },
    sheet: structuredClone(normalizeSheet(c.sheet)),
  };
}

/** Só o que mudou vai no PATCH; chave removida vira null (merge patch). */
function diffStats(before: StatMap, after: StatMap): Record<string, number | null> | undefined {
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(after)) {
    if (before[key] !== value) {
      out[key] = value;
    }
  }

  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      out[key] = null;
    }
  }

  return Object.keys(out).length ? out : undefined;
}

export function buildPatch(c: Character, d: Draft): CharacterPatch {
  const patch: CharacterPatch = {};
  if (d.name.trim() !== c.name) {
    patch.name = d.name.trim();
  }

  if (d.description.trim() !== (c.description ?? "")) {
    patch.description = d.description.trim() || null;
  }

  if (d.hpCurrent !== c.hp.current || d.hpMax !== c.hp.max) {
    patch.hp = { current: d.hpCurrent, max: d.hpMax };
  }

  if (d.maxItems !== c.capacity.maxItems) {
    patch.maxItems = d.maxItems;
  }

  if (d.active !== c.active) {
    patch.active = d.active;
  }

  const attributes = diffStats(c.attributes, d.attributes);
  if (attributes) {
    patch.attributes = attributes;
  }

  const skills = diffStats(c.skills, d.skills);
  if (skills) {
    patch.skills = skills;
  }

  if (JSON.stringify(d.sheet) !== JSON.stringify(normalizeSheet(c.sheet))) {
    patch.sheet = d.sheet;
  }

  return patch;
}

/** Primeiro problema que impede salvar o rascunho, ou "" se ele está válido. */
export function validate(d: Draft, slotsUsed: number): string {
  if (!d.name.trim()) {
    return "O personagem precisa de um nome.";
  }

  if (!(d.hpMax >= 1)) {
    return "Os pontos de vida máximos começam em 1.";
  }

  if (!(d.hpCurrent >= 0) || d.hpCurrent > d.hpMax) {
    return "Os pontos de vida atuais ficam entre 0 e o máximo.";
  }

  if (!(d.maxItems >= 0)) {
    return "O tamanho da mochila não pode ser negativo.";
  }

  if (!Number.isSafeInteger(d.maxItems) || d.maxItems > 1000)
    return "O máximo da mochila deve ser um inteiro entre 0 e 1000.";

  if (d.maxItems < slotsUsed) {
    return `A mochila já tem ${slotsUsed} espaço(s) em uso; não dá para deixá-la menor que isso.`;
  }

  for (const key of ["level", "defense", "money"]) {
    const value = d.sheet.header?.[key];
    if (value !== undefined && value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0))
      return `O campo ${key} precisa ser um número não negativo.`;
  }

  for (const block of d.sheet.columns.flat()) {
    if (block.type === "skills" && block.data.diceFormulas &&
      Object.values(block.data.diceFormulas).some((formula) => typeof formula !== "string" || (formula.trim() !== "" && !parseFormula(formula))))
      return "Uma perícia tem fórmula de rolagem inválida.";
    if (block.type === "dice" && Array.isArray(block.data.rolls) && block.data.rolls.some((roll) =>
      typeof roll?.expr !== "string" || !parseFormula(roll.expr)))
      return "Uma rolagem tem fórmula inválida.";
    if (block.type === "list" && Array.isArray(block.data.items)) {
      if (block.data.items.some((item) => typeof item === "object" && item !== null && item.roll &&
        (typeof item.roll !== "string" || !parseFormula(item.roll))))
        return "Uma rolagem da lista tem fórmula inválida.";
    }
    if (block.type !== "backpack") continue;
    const rows = Array.isArray(block.data.rows) ? block.data.rows : [];
    if (rows.some((row) => !String(row?.cells?.name ?? "").trim()))
      return "Cada item da mochila precisa de um nome.";
    const spaces = rows.reduce((sum: number, row) => sum + Number(row?.cells?.spaces || 0), 0);
    if (rows.some((row) => !Number.isSafeInteger(Number(row?.cells?.spaces || 0)) || Number(row?.cells?.spaces || 0) < 0))
      return "Os espaços dos itens precisam ser inteiros não negativos.";
    if (spaces > d.maxItems && block.data.allowOverflow !== true)
      return "A mochila excede o máximo. Ative a opção de permitir exceder ou ajuste os espaços.";
  }

  return "";
}
