/** Um item conquistado na campanha. */
export interface Activity {
  operationId: string;
  characterId: string;
  itemId: string;
  itemName: string | null;
  quantity: number;
  occurredAt: string;
}

/** Quanto de um item a campanha já conquistou. */
export interface ItemTotal {
  itemId: string;
  itemName: string | null;
  quantity: number;
}

/** Quanto um personagem já conquistou. */
export interface CharacterTotal {
  characterId: string;
  quantity: number;
}

/** O resumo da campanha: totais calculados sobre toda a atividade (modelo de leitura do S1). */
export interface CampaignSummary {
  /** Quantas aquisições foram registradas. */
  acquisitions: number;
  /** Soma das quantidades de todas as aquisições. */
  totalQuantity: number;
  /** Itens mais conquistados primeiro. */
  topItems: ItemTotal[];
  /** Personagens que mais conquistaram primeiro. */
  byCharacter: CharacterTotal[];
  /** Data da aquisição mais recente; null se não houve nenhuma. */
  lastAcquiredAt: string | null;
}
