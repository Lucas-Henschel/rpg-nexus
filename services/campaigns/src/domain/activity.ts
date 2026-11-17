/** Um item conquistado na campanha. */
export interface Activity {
  operationId: string;
  characterId: string;
  itemId: string;
  itemName: string | null;
  quantity: number;
  occurredAt: string;
}
