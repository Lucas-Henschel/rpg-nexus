// Modelos de ficha no S2 Personagens. O S1 pergunta com o token de quem chamou, então só acha os
// modelos dessa pessoa, e guarda só id, versão e nome: a definição do modelo continua no S2.
import { z } from "zod";
import { CharactersUnavailable } from "../domain/errors.js";
import type { TemplateCatalog } from "../services/campaigns.js";
import { traceHeaders } from "../tracing/spans.js";

export interface TemplateCatalogOptions {
  /** Endereço do S2, como `http://characters:8000`. */
  baseUrl: string;
  timeoutMs: number;
  fetch?: typeof globalThis.fetch;
}

/** O que o S1 usa da resposta de `GET /templates/{id}`. */
const TemplateResponse = z.object({
  templateId: z.string(),
  version: z.number().int().positive(),
  name: z.string(),
});

export function createTemplateCatalog({
  baseUrl,
  timeoutMs,
  fetch = globalThis.fetch,
}: TemplateCatalogOptions): TemplateCatalog {
  return {
    async find(templateId, version, authorization) {
      const url = new URL(`/templates/${encodeURIComponent(templateId)}`, baseUrl);

      if (version !== undefined) {
        url.searchParams.set("version", String(version));
      }

      let response: Response;

      try {
        response = await fetch(url, {
          headers: { authorization, ...traceHeaders() },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new CharactersUnavailable(error);
      }

      // O S2 responde 404 também para o modelo de outra pessoa, sem revelar que ele existe.
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new CharactersUnavailable(`GET ${url.pathname}: ${response.status}`);
      }

      const body = TemplateResponse.safeParse(await response.json().catch(() => null));

      if (!body.success) {
        throw new CharactersUnavailable(body.error);
      }

      return body.data;
    },
  };
}
