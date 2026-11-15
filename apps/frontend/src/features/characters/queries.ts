/** Consultas do S2 Personagens. As telas usam estes hooks em vez de chamar a API em efeitos. */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { getCharacter, listCharacters, listHolds } from "../../api/characters";
import { ApiError } from "../../api/http";

export const characterKeys = {
  list: (campaignId: string) => ["characters", "list", campaignId] as const,
  detail: (id: string) => ["characters", "detail", id] as const,
  holds: (id: string) => ["characters", "holds", id] as const,
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

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}
