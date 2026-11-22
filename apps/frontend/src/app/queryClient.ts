import { QueryClient } from "@tanstack/react-query";
import { ApiError, isMembershipPending, MEMBERSHIP_RETRY_DELAYS_MS } from "../shared/http";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // NOT_CAMPAIGN_MEMBER logo depois de entrar na campanha é passageiro: o S2 ainda não recebeu o
      // evento do S1. Os outros 4xx não melhoram tentando de novo (ficha inexistente, campanha inválida).
      retry: (failures, error) => {
        if (isMembershipPending(error)) {
          return failures < MEMBERSHIP_RETRY_DELAYS_MS.length;
        }

        return (
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2
        );
      },
      // `failures` começa em 0 na primeira falha, como no retryDelay padrão do TanStack Query.
      retryDelay: (failures, error) =>
        isMembershipPending(error)
          ? (MEMBERSHIP_RETRY_DELAYS_MS[failures] ?? 3000)
          : Math.min(1000 * 2 ** failures, 30000),
    },
  },
});
