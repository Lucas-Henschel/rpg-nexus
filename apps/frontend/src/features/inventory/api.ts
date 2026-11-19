/** Adaptador tipado do S3 Inventário. */
import { services } from "../../shared/config";
import { jsonBody, request } from "../../shared/http";

const base = services.inventory.url;

export interface Item {
  itemId: string;
  name: string;
}

export interface Stock {
  campaignId: string;
  itemId: string;
  available: number;
}
export interface Shop { campaignId: string; name: string; active: boolean; }
export interface ShopItem {
  campaignId: string; itemId: string; name: string; description: string;
  price: number; available: number; reserved: number;
}

export interface InventoryEntry {
  operationId: string;
  campaignId: string;
  itemId: string;
  quantity: number;
}

export type AcquisitionStatus =
  | "PENDING" | "RESERVED" | "VALIDATING_CHARACTER" | "VALIDATING_EXTERNAL"
  | "COMPLETED" | "COMPENSATING" | "COMPENSATED" | "REJECTED" | "EXPIRED";

export interface Acquisition {
  operationId: string;
  campaignId: string;
  characterId: string;
  itemId: string;
  price: number;
  status: AcquisitionStatus;
  deadlineAt: string;
}

export interface AcquisitionAccepted {
  operationId: string;
  statusUrl: string;
}

export function listItems(): Promise<Item[]> {
  return request<Item[]>(base, "/items").then((response) => response.data);
}

export function listStocks(campaignId: string): Promise<Stock[]> {
  return request<Stock[]>(base, `/stocks?campaignId=${encodeURIComponent(campaignId)}`)
    .then((response) => response.data);
}

export function getStock(campaignId: string, itemId: string): Promise<Stock> {
  return request<Stock>(base, `/stocks/${encodeURIComponent(campaignId)}/${encodeURIComponent(itemId)}`)
    .then((response) => response.data);
}

export function getInventory(characterId: string): Promise<InventoryEntry[]> {
  return request<InventoryEntry[]>(base, `/inventory/${encodeURIComponent(characterId)}`)
    .then((response) => response.data);
}

export function createItem(itemId: string, name: string): Promise<void> {
  return request(base, "/items", { method: "POST", ...jsonBody({ itemId, name }) }).then(() => undefined);
}

export function createStock(campaignId: string, itemId: string, available: number, userId: string): Promise<void> {
  return request(base, "/stocks", {
    method: "POST", ...jsonBody({ campaignId, itemId, available }, { "X-User-Id": userId }),
  }).then(() => undefined);
}

export function getShop(campaignId: string): Promise<Shop> {
  return request<Shop>(base, `/shops/${encodeURIComponent(campaignId)}`).then((response) => response.data);
}

export function saveShop(campaignId: string, name: string, active: boolean, userId: string): Promise<Shop> {
  return request<Shop>(base, `/shops/${encodeURIComponent(campaignId)}`, {
    method: "PUT", ...jsonBody({ name, active }, { "X-User-Id": userId }),
  }).then((response) => response.data);
}

export function listShopItems(campaignId: string): Promise<ShopItem[]> {
  return request<ShopItem[]>(base, `/shops/${encodeURIComponent(campaignId)}/items`).then((response) => response.data);
}

export function saveShopItem(campaignId: string, item: Omit<ShopItem, "campaignId" | "reserved">, userId: string): Promise<ShopItem> {
  return request<ShopItem>(base, `/shops/${encodeURIComponent(campaignId)}/items/${encodeURIComponent(item.itemId)}`, {
    method: "PUT", ...jsonBody(item, { "X-User-Id": userId }),
  }).then((response) => response.data);
}

export async function acquireItem(campaignId: string, characterId: string, itemId: string, userId: string): Promise<AcquisitionAccepted> {
  const response = await request<AcquisitionAccepted>(base, "/acquisitions", {
    method: "POST",
    ...jsonBody({ campaignId, characterId, itemId }, {
      "Idempotency-Key": crypto.randomUUID(), "X-User-Id": userId,
    }),
  });
  if (response.status !== 202) throw new Error("A aquisição não foi aceita para processamento.");
  return response.data;
}

export function getAcquisition(operationId: string): Promise<Acquisition> {
  return request<Acquisition>(base, `/acquisitions/${encodeURIComponent(operationId)}`)
    .then((response) => response.data);
}
