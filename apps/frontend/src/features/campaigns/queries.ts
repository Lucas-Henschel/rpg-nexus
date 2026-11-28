/** Consultas e alterações do S1 Campanhas. As telas usam estes hooks em vez de chamar a API. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assignTemplate,
  chooseCharacter,
  createCampaign,
  getCampaign,
  getCampaignSummary,
  joinCampaign,
  listMyCampaigns,
  removeMember,
} from "./api";

export const campaignKeys = {
  all: ["campaigns"] as const,
  list: (userId: string) => ["campaigns", "list", userId] as const,
  detail: (id: string) => ["campaigns", "detail", id] as const,
  summary: (id: string) => ["campaigns", "summary", id] as const,
};

export function useCampaigns(userId: string) {
  return useQuery({
    queryKey: campaignKeys.list(userId),
    queryFn: listMyCampaigns,
    enabled: Boolean(userId),
  });
}

export function useCampaignView(id: string) {
  return useQuery({
    queryKey: campaignKeys.detail(id),
    queryFn: () => getCampaign(id),
    // Itens conquistados e jogadores novos chegam sem ninguém mexer na tela: busca de novo a cada 5 s.
    refetchInterval: 5_000,
  });
}

export function useCampaignSummary(id: string) {
  return useQuery({
    queryKey: campaignKeys.summary(id),
    queryFn: () => getCampaignSummary(id),
    refetchInterval: 5_000,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => createCampaign(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: campaignKeys.all }),
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
