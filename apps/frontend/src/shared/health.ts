import { useQueries, useQuery } from "@tanstack/react-query";
import { services, type ServiceKey } from "./config";

export type Health = "checking" | "up" | "down";

async function ping(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * GET /health a cada 10 s. A chave é por serviço: telas que olham o mesmo serviço dividem a mesma
 * consulta, em vez de cada uma ligar o próprio timer.
 */
function healthQuery(key: ServiceKey) {
  return {
    queryKey: ["health", key],
    queryFn: () => ping(services[key].url),
    refetchInterval: 10_000,
    // Abrir outra tela no meio do intervalo reaproveita o resultado em vez de consultar de novo.
    staleTime: 10_000,
  };
}

function toHealth(up: boolean | undefined): Health {
  if (up === undefined) {
    return "checking";
  }
  return up ? "up" : "down";
}

export function useServiceHealth(key: ServiceKey): Health {
  return toHealth(useQuery(healthQuery(key)).data);
}

export function useAllServicesHealth(): Record<ServiceKey, Health> {
  const keys = Object.keys(services) as ServiceKey[];
  const results = useQueries({ queries: keys.map(healthQuery) });
  return Object.fromEntries(keys.map((key, i) => [key, toHealth(results[i].data)])) as Record<
    ServiceKey,
    Health
  >;
}
