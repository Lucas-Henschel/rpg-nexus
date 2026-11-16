/** Consultas e alterações do S1 Campanhas. As telas usam estes hooks em vez de chamar a API. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMember, createCampaign, getCampaign, listCampaigns, type CampaignInput } from "./api";

export const campaignKeys = {
  list: ["campaigns", "list"] as const,
  detail: (id: string) => ["campaigns", "detail", id] as const,
};

export function useCampaigns() {
  return useQuery({ queryKey: campaignKeys.list, queryFn: listCampaigns });
}

export function useCampaignView(id: string) {
  return useQuery({
    queryKey: campaignKeys.detail(id),
    queryFn: () => getCampaign(id),
    // Os itens conquistados chegam pelo RabbitMQ, sem ninguém mexer na tela: busca de novo a cada 5 s.
    refetchInterval: 5_000,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CampaignInput) => createCampaign(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.list }),
  });
}

export function useAddMember(campaignId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ characterId, characterName }: { characterId: string; characterName: string }) =>
      addMember(campaignId, characterId, characterName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) }),
  });
}
