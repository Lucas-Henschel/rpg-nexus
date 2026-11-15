/** Adaptador tipado do S2 Personagens. As telas nunca chamam fetch direto. */
import { services } from "../config";
import { jsonBody, request } from "./http";

const base = services.characters.url;

export type StatMap = Record<string, number>;

export type BlockType = "attributes" | "skills" | "hp" | "backpack" | "text" | "counter" | "dice" | "list";

/** Um bloco da ficha. `data` guarda o conteúdo dos blocos livres (texto, contador, rolagens, lista). */
export interface SheetBlock {
  id: string;
  type: BlockType;
  title: string;
  data: Record<string, unknown>;
}

/** Organização livre da ficha: colunas de blocos. O serviço guarda e devolve sem interpretar. */
export interface Sheet {
  template: string | null;
  columns: SheetBlock[][];
}

export interface Character {
  id: string;
  campaignId: string;
  name: string;
  ownerId: string | null;
  description: string | null;
  attributes: StatMap;
  skills: StatMap;
  hp: { current: number; max: number };
  active: boolean;
  capacity: { maxItems: number; slotsUsed: number; slotsAvailable: number };
  portrait: { key: string; contentType: string; sizeBytes: number; uploadedAt: string } | null;
  sheet: Sheet | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterInput {
  campaignId: string;
  name: string;
  description?: string;
  attributes: StatMap;
  skills: StatMap;
  hp: { current: number; max: number };
  maxItems: number;
  sheet?: Sheet;
}

/** PATCH com semântica de merge: em attributes/skills, null remove a chave. */
export interface CharacterPatch {
  name?: string;
  description?: string | null;
  attributes?: Record<string, number | null>;
  skills?: Record<string, number | null>;
  hp?: { current: number; max: number };
  maxItems?: number;
  active?: boolean;
  sheet?: Sheet;
}

export interface Hold {
  operationId: string;
  quantity: number;
  status: "HELD" | "COMMITTED" | "RELEASED";
  itemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PORTRAIT_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const PORTRAIT_MAX_BYTES = 2 * 1024 * 1024;

export async function listCharacters(campaignId: string): Promise<Character[]> {
  const all: Character[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ campaignId, limit: "100" });
    if (cursor) query.set("cursor", cursor);
    const page: { items: Character[]; nextCursor: string | null } = (
      await request<{ items: Character[]; nextCursor: string | null }>(base, `/characters?${query}`)
    ).data;
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}

export async function getCharacter(id: string): Promise<Character> {
  return (await request<Character>(base, `/characters/${encodeURIComponent(id)}`)).data;
}

export async function createCharacter(input: CharacterInput): Promise<Character> {
  return (await request<Character>(base, "/characters", { method: "POST", ...jsonBody(input) })).data;
}

/** If-Match com a versão que a tela carregou: o serviço responde 412 se a ficha mudou nesse meio-tempo. */
export async function updateCharacter(id: string, patch: CharacterPatch, version: number): Promise<Character> {
  const init = { method: "PATCH", ...jsonBody(patch, { "If-Match": `"${version}"` }) };
  return (await request<Character>(base, `/characters/${encodeURIComponent(id)}`, init)).data;
}

export async function listHolds(id: string): Promise<Hold[]> {
  return (await request<{ items: Hold[] }>(base, `/characters/${encodeURIComponent(id)}/holds`)).data.items;
}

/** Envia o retrato pelo backend, que valida e grava no S3. */
export async function uploadPortrait(id: string, file: File): Promise<Character> {
  const init = { method: "PUT", body: file, headers: { "Content-Type": file.type } };
  return (await request<Character>(base, `/characters/${encodeURIComponent(id)}/portrait`, init)).data;
}

export function portraitUrl(character: Character): string | null {
  if (!character.portrait) return null;
  const stamp = encodeURIComponent(character.portrait.uploadedAt);
  return `${base}/characters/${encodeURIComponent(character.id)}/portrait/content?v=${stamp}`;
}
