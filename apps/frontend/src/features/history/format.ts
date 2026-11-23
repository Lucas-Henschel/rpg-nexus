import type { HistoryEntry } from "./api";

const REASONS: Record<NonNullable<HistoryEntry["reason"]>, string> = {
  CHARACTER_REJECTED: "O personagem não pôde receber o item",
  EXTERNAL_VALIDATION_FAILED: "A validação externa recusou o pedido",
  DEADLINE_EXPIRED: "O prazo da operação terminou",
  PAYMENT_REJECTED: "O personagem não possuía saldo suficiente",
  LEFT: "O participante saiu da campanha",
  REMOVED: "O participante foi removido da campanha",
};

export const TITLES: Record<HistoryEntry["type"], string> = {
  CAMPAIGN_CREATED: "Campanha criada",
  MEMBER_JOINED: "Participante entrou",
  MEMBER_REMOVED: "Participante saiu",
  SHOP_ITEM_PURCHASED: "Compra realizada",
  ITEM_ACQUIRED: "Item entregue",
  ACQUISITION_CANCELLED: "Pedido cancelado",
};

export function description(entry: HistoryEntry, characterNames?: Map<string, string>): string {
  const character = entry.characterId ? characterNames?.get(entry.characterId) ?? "O personagem" : "O personagem";

  switch (entry.type) {
    case "CAMPAIGN_CREATED":
      return `${entry.ownerName ?? "O mestre"} criou a campanha ${entry.campaignName ?? "atual"}.`;
    case "MEMBER_JOINED":
      return `${entry.username ?? "Um participante"} entrou como ${entry.role === "OWNER" ? "mestre" : "jogador"}.`;
    case "MEMBER_REMOVED":
      return `${entry.username ?? "Um participante"} ${entry.reason === "LEFT" ? "saiu" : "foi removido"} da campanha.`;
    case "SHOP_ITEM_PURCHASED":
      return `${character} comprou ${entry.quantity ?? 1}× ${entry.itemName ?? "um item"}${entry.amount !== undefined ? ` por ${entry.amount} moedas` : ""}.`;
    case "ITEM_ACQUIRED":
      return `${character} recebeu ${entry.quantity ?? 1}× ${entry.itemName ?? "um item"}.`;
    case "ACQUISITION_CANCELLED": {
      const reason = entry.reason ? REASONS[entry.reason] : "A entrega do item foi cancelada";
      const item = entry.itemName ? ` de ${entry.itemName}` : "";

      return entry.detail ? `Pedido${item} cancelado: ${reason}. ${entry.detail}` : `Pedido${item} cancelado: ${reason}.`;
    }
  }
}
