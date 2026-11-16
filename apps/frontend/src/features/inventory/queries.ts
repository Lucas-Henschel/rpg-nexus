import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acquireItem, createItem, createStock, getAcquisition, getInventory, getStock, listItems, listStocks } from "./api";

const keys = {
  catalog: ["inventory", "catalog"] as const,
  stocks: (campaignId: string) => ["inventory", "stocks", campaignId] as const,
  stock: (campaignId: string, itemId: string) => ["inventory", "stock", campaignId, itemId] as const,
  items: (characterId: string) => ["inventory", "character", characterId] as const,
  acquisition: (operationId: string) => ["inventory", "acquisition", operationId] as const,
};

export function useCatalog(campaignId: string) {
  const items = useQuery({ queryKey: keys.catalog, queryFn: listItems });
  const stocks = useQuery({ queryKey: keys.stocks(campaignId), queryFn: () => listStocks(campaignId), enabled: Boolean(campaignId) });
  return { items, stocks };
}

export function useStock(campaignId: string, itemId: string) {
  return useQuery({
    queryKey: keys.stock(campaignId, itemId),
    queryFn: () => getStock(campaignId, itemId),
    enabled: Boolean(campaignId && itemId),
    retry: false,
  });
}

export function useInventory(characterId: string) {
  return useQuery({
    queryKey: keys.items(characterId),
    queryFn: () => getInventory(characterId),
    enabled: Boolean(characterId),
  });
}

export function useAcquisition(operationId: string) {
  return useQuery({
    queryKey: keys.acquisition(operationId),
    queryFn: () => getAcquisition(operationId),
    enabled: Boolean(operationId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && ["COMPLETED", "COMPENSATED", "REJECTED", "EXPIRED"].includes(status) ? false : 2000;
    },
  });
}

export function useInventoryActions() {
  const client = useQueryClient();
  return {
    createItem: useMutation({
      mutationFn: ({ itemId, name }: { itemId: string; name: string }) => createItem(itemId, name),
      onSuccess: () => void client.invalidateQueries({ queryKey: keys.catalog }),
    }),
    createStock: useMutation({
      mutationFn: ({ campaignId, itemId, available }: { campaignId: string; itemId: string; available: number }) =>
        createStock(campaignId, itemId, available),
      onSuccess: () => {
        void client.invalidateQueries({ queryKey: ["inventory", "stock"] });
        void client.invalidateQueries({ queryKey: ["inventory", "stocks"] });
      },
    }),
    acquire: useMutation({
      mutationFn: ({ campaignId, characterId, itemId }: { campaignId: string; characterId: string; itemId: string }) =>
        acquireItem(campaignId, characterId, itemId),
      onSuccess: () => void client.invalidateQueries({ queryKey: ["inventory", "stock"] }),
    }),
    refreshOutcome: (characterId: string) => {
      void client.invalidateQueries({ queryKey: ["inventory", "stock"] });
      void client.invalidateQueries({ queryKey: ["inventory", "stocks"] });
      void client.invalidateQueries({ queryKey: keys.items(characterId) });
    },
  };
}
