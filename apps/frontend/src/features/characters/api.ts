/**
 * Adaptador tipado do S2 Personagens. As telas nunca chamam fetch direto.
 * Toda rota exige login: as chamadas vão com o access token do S4 (authorizedRequest).
 */
import { services } from "../../shared/config";
import { ApiError, jsonBody } from "../../shared/http";
import { authorizedRequest } from "../auth/session";

const base = services.characters.url;
export const PERSONAL_CAMPAIGN = "__personal__";

export type StatMap = Record<string, number>;

export type BlockType =
  "attributes" | "skills" | "hp" | "backpack" | "text" | "counter" | "dice" | "list";

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
  header?: Record<string, unknown>;
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
  /** Só o S2 altera o saldo: por ajuste do dono ou pela compra na loja. */
  currency: Currency;
  /** Modelo e versão de onde a ficha foi copiada. */
  sourceTemplate: { templateId: string; version: number } | null;
  /**
   * O que quem está logado pode fazer: só o dono edita.
   * O mestre da campanha também abre as fichas dos jogadores, só para ler.
   */
  access?: { edit: boolean };
  createdAt: string;
  updatedAt: string;
}

export interface Currency {
  name: string;
  amount: number;
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
  currency?: Currency;
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
  currencyAmount?: number;
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
    if (cursor) {
      query.set("cursor", cursor);
    }

    const page: { items: Character[]; nextCursor: string | null } = (
      await authorizedRequest<{ items: Character[]; nextCursor: string | null }>(base, `/characters?${query}`)
    ).data;
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return all;
}

export async function getCharacter(id: string): Promise<Character> {
  return (await authorizedRequest<Character>(base, `/characters/${encodeURIComponent(id)}`)).data;
}

export async function createCharacter(input: CharacterInput): Promise<Character> {
  return (await authorizedRequest<Character>(base, "/characters", { method: "POST", ...jsonBody(input) }))
    .data;
}

export async function assignCharacterCampaign(id: string, campaignId: string): Promise<Character> {
  return (await authorizedRequest<Character>(base, `/characters/${encodeURIComponent(id)}/campaign`,
    { method: "PUT", ...jsonBody({ campaignId }) })).data;
}

/** If-Match com a versão que a tela carregou: o serviço responde 412 se a ficha mudou nesse meio-tempo. */
export async function updateCharacter(
  id: string,
  patch: CharacterPatch,
  version: number,
): Promise<Character> {
  const init = { method: "PATCH", ...jsonBody(patch, { "If-Match": `"${version}"` }) };

  return (await authorizedRequest<Character>(base, `/characters/${encodeURIComponent(id)}`, init)).data;
}

export async function listHolds(id: string): Promise<Hold[]> {
  return (await authorizedRequest<{ items: Hold[] }>(base, `/characters/${encodeURIComponent(id)}/holds`))
    .data.items;
}

/** Envia o retrato pelo backend, que valida e grava no S3. */
export async function uploadPortrait(id: string, file: File): Promise<Character> {
  const init = { method: "PUT", body: file, headers: { "Content-Type": file.type } };

  return (await authorizedRequest<Character>(base, `/characters/${encodeURIComponent(id)}/portrait`, init))
    .data;
}

/**
 * Endereço do retrato para o <img>. É a única rota sem login: a imagem não tem como mandar o token,
 * e o endereço só é conhecido por quem já leu a ficha.
 */
export function portraitUrl(character: Character): string | null {
  if (!character.portrait) {
    return null;
  }

  const stamp = encodeURIComponent(character.portrait.uploadedAt);

  return `${base}/characters/${encodeURIComponent(character.id)}/portrait/content?v=${stamp}`;
}

// --- Dinheiro ---------------------------------------------------------------------------------

export interface MoneyEntry {
  operationId: string;
  kind: "PURCHASE" | "ADJUSTMENT";
  amount: number;
  status: "DEBITED" | "REFUNDED" | null;
  reason: string | null;
  createdAt: string;
}

export async function listMoney(id: string): Promise<MoneyEntry[]> {
  return (
    await authorizedRequest<{ items: MoneyEntry[] }>(
      base,
      `/characters/${encodeURIComponent(id)}/money/transactions`,
    )
  ).data.items;
}

// --- Modelos de ficha salvos no S2 -------------------------------------------------------------

export interface InitialValues {
  attributes: StatMap;
  skills: StatMap;
  hpMax: number;
  maxItems: number;
  currency: Currency;
}

/** Modelo privado de quem está logado. Cada edição gera uma versão nova. */
export interface SavedTemplate {
  templateId: string;
  name: string;
  description: string | null;
  version: number;
  sheetDefinition: Sheet | null;
  initialValues: InitialValues;
  updatedAt: string;
}

export interface TemplateInput {
  name: string;
  description?: string;
  sheetDefinition: Sheet;
  initialValues: InitialValues;
}

export async function listTemplates(): Promise<SavedTemplate[]> {
  return (await authorizedRequest<{ items: SavedTemplate[] }>(base, "/templates")).data.items;
}

/** O serviço guarda só a estrutura: anotações, listas e o cabeçalho da ficha saem vazios. */
export async function createTemplate(input: TemplateInput): Promise<SavedTemplate> {
  return (await authorizedRequest<SavedTemplate>(base, "/templates", { method: "POST", ...jsonBody(input) }))
    .data;
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await authorizedRequest<null>(base, `/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" });
}

/**
 * Modelo que o mestre definiu na campanha, na versão dele. Qualquer participante consulta; sem modelo
 * definido, devolve null.
 */
export async function getCampaignTemplate(campaignId: string): Promise<SavedTemplate | null> {
  try {
    return (await authorizedRequest<SavedTemplate>(base, `/campaigns/${encodeURIComponent(campaignId)}/template`))
      .data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

/** Ficha nova copiando o modelo: a versão pedida ou, sem ela, a atual. */
export async function createFromTemplate(
  templateId: string,
  input: { campaignId: string; name: string; version?: number },
): Promise<Character> {
  const init = { method: "POST", ...jsonBody(input) };

  return (
    await authorizedRequest<Character>(base, `/characters/from-template/${encodeURIComponent(templateId)}`, init)
  ).data;
}
