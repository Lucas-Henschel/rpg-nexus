/** Consultas e alterações do S2 Personagens. As telas usam estes hooks em vez de chamar a API. */
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTemplate,
  deleteTemplate,
  getCampaignTemplate,
  getCharacter,
  listCharacters,
  listHolds,
  listTemplates,
  updateCharacter,
  uploadPortrait,
  type Character,
  type CharacterPatch,
  type TemplateInput,
} from "./api";

export const characterKeys = {
  list: (campaignId: string) => ["characters", "list", campaignId] as const,
  detail: (id: string) => ["characters", "detail", id] as const,
  holds: (id: string) => ["characters", "holds", id] as const,
  templates: ["characters", "templates"] as const,
  campaignTemplate: (campaignId: string) =>
    ["characters", "campaign-template", campaignId] as const,
};

export function useCharacters(campaignId: string) {
  return useQuery({
    queryKey: characterKeys.list(campaignId),
    queryFn: () => listCharacters(campaignId),
  });
}

export function characterQuery(id: string) {
  return queryOptions({
    queryKey: characterKeys.detail(id),
    queryFn: () => getCharacter(id),
    // A ficha é a base do rascunho em edição e da versão enviada no If-Match. Recarregar sozinha
    // trocaria essa base por baixo do rascunho e o PATCH sobrescreveria mudanças de outra pessoa
    // sem o 412. Ela só é recarregada quando a tela pede.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useCharacter(id: string) {
  return useQuery(characterQuery(id));
}

export function useHolds(id: string) {
  return useQuery({
    queryKey: characterKeys.holds(id),
    queryFn: () => listHolds(id),
  });
}

/** Busca de novo a ficha e as reservas, ignorando o cache. Devolve a ficha atual. */
export function useReloadCharacter(id: string) {
  const queryClient = useQueryClient();

  return async (): Promise<Character> => {
    const [fresh] = await Promise.all([
      queryClient.fetchQuery({ ...characterQuery(id), staleTime: 0 }),
      queryClient.refetchQueries({ queryKey: characterKeys.holds(id) }),
    ]);

    return fresh;
  };
}

/** A resposta do PATCH e do upload já é a ficha nova: ela vai direto para o cache. */
function useStoreCharacter() {
  const queryClient = useQueryClient();

  return (updated: Character) =>
    queryClient.setQueryData(characterKeys.detail(updated.id), updated);
}

export function useSaveCharacter(id: string) {
  const store = useStoreCharacter();

  return useMutation({
    // A versão vai junto de cada chamada: é a da ficha que estava na tela no clique.
    mutationFn: ({ patch, version }: { patch: CharacterPatch; version: number }) =>
      updateCharacter(id, patch, version),
    onSuccess: store,
  });
}

export function useUploadPortrait(id: string) {
  const store = useStoreCharacter();

  return useMutation({
    mutationFn: (file: File) => uploadPortrait(id, file),
    onSuccess: store,
  });
}

/** Modelo de ficha da campanha (definido pelo mestre no S1); null quando não há. */
export function useCampaignTemplate(campaignId: string) {
  return useQuery({
    queryKey: characterKeys.campaignTemplate(campaignId),
    queryFn: () => getCampaignTemplate(campaignId),
    enabled: Boolean(campaignId),
  });
}

export function useTemplates() {
  return useQuery({ queryKey: characterKeys.templates, queryFn: listTemplates });
}

export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: TemplateInput) => createTemplate(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: characterKeys.templates }),
  });
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (templateId: string) => deleteTemplate(templateId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: characterKeys.templates }),
  });
}
