/** Consultas e alterações do S1 Campanhas. As telas usam estes hooks em vez de chamar a API. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignTemplate,
  chooseCharacter,
  createCampaign,
  getCampaign,
  joinCampaign,
  listMyCampaigns,
  removeMember,
} from "./api";

export const campaignKeys = {
  all: ["campaigns"] as const,
  list: ["campaigns", "list"] as const,
  detail: (id: string) => ["campaigns", "detail", id] as const,
};

export function useCampaigns() {
  return useQuery({ queryKey: campaignKeys.list, queryFn: listMyCampaigns });
}

export function useCampaignView(id: string) {
  return useQuery({
    queryKey: campaignKeys.detail(id),
    queryFn: () => getCampaign(id),
    // Itens conquistados e jogadores novos chegam sem ninguém mexer na tela: busca de novo a cada 5 s.
    refetchInterval: 5_000,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => createCampaign(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.list }),
  });
}

export function useJoinCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (joinCode: string) => joinCampaign(joinCode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

export function useChooseCharacter(campaignId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ characterId, characterName }: { characterId: string; characterName: string }) =>
      chooseCharacter(campaignId, characterId, characterName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) }),
  });
}

export function useAssignTemplate(campaignId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (templateId: string) => assignTemplate(campaignId, templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.detail(campaignId) }),
  });
}

export function useRemoveMember(campaignId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => removeMember(campaignId, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
  });
}

/** Código de entrada da campanha, para mostrar no lugar do id. Sem a campanha na lista da pessoa, fica o id. */
export function useCampaignCode(campaignId: string) {
  const campaigns = useCampaigns();

  return campaigns.data?.find((campaign) => campaign.campaignId === campaignId)?.joinCode ?? campaignId;
}
