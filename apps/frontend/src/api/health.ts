import { useEffect, useState } from "react";
import { services, type ServiceKey } from "../config";

export type Health = "checking" | "up" | "down";

async function ping(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
}

/** Consulta GET /health de cada serviço a cada 10 s. */
export function useServiceHealth(): Record<ServiceKey, Health> {
  const keys = Object.keys(services) as ServiceKey[];
  const [state, setState] = useState(
    () => Object.fromEntries(keys.map((k) => [k, "checking"])) as Record<ServiceKey, Health>,
  );

  useEffect(() => {
    let alive = true;
    const check = () =>
      keys.forEach(async (key) => {
        const ok = await ping(services[key].url);
        if (alive) setState((prev) => ({ ...prev, [key]: ok ? "up" : "down" }));
      });
    check();
    const timer = setInterval(check, 10_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
