import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "../shared/http";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Erro 4xx não melhora tentando de novo (ficha inexistente, campanha inválida).
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2,
    },
  },
});
