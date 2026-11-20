import { describe, expect, it } from "vitest";
import { CharactersUnavailable } from "../../src/domain/errors.js";
import { createTemplateCatalog } from "../../src/integrations/templates.js";

const TOKEN = "Bearer token-da-ana";

/** Responde como o S2 e guarda o que foi pedido. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const requests: { url: string; headers: Headers }[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers) });

    return respond();
  };

  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const catalog = (fetch: typeof globalThis.fetch) =>
  createTemplateCatalog({ baseUrl: "http://characters:8000", timeoutMs: 1000, fetch });

describe("modelos de ficha no S2", () => {
  it("pede a versão com o token de quem chamou e devolve id, versão e nome", async () => {
    const s2 = fakeFetch(() =>
      json(200, { templateId: "t1", version: 2, name: "Aventureiro", ownerId: "u-ana" }),
    );

    expect(await catalog(s2.fetch).find("t1", 2, TOKEN)).toEqual({
      templateId: "t1",
      version: 2,
      name: "Aventureiro",
    });
    expect(s2.requests[0]?.url).toBe("http://characters:8000/templates/t1?version=2");
    expect(s2.requests[0]?.headers.get("authorization")).toBe(TOKEN);
  });

  it("sem versão, pede a atual", async () => {
    const s2 = fakeFetch(() => json(200, { templateId: "t1", version: 5, name: "Aventureiro" }));

    expect((await catalog(s2.fetch).find("t1", undefined, TOKEN))?.version).toBe(5);
    expect(s2.requests[0]?.url).toBe("http://characters:8000/templates/t1");
  });

  it("404 (não existe ou é de outra pessoa) → null", async () => {
    const s2 = fakeFetch(() => json(404, { error: { code: "TEMPLATE_NOT_FOUND" } }));

    expect(await catalog(s2.fetch).find("t1", undefined, TOKEN)).toBeNull();
  });

  it.each([
    ["erro do S2", () => json(500, {})],
    ["S2 fora do ar", () => Promise.reject(new TypeError("fetch failed"))],
    ["resposta fora do formato", () => json(200, { templateId: "t1" })],
  ])("%s → CharactersUnavailable", async (_, respond) => {
    const s2 = fakeFetch(respond);

    await expect(catalog(s2.fetch).find("t1", undefined, TOKEN)).rejects.toBeInstanceOf(
      CharactersUnavailable,
    );
  });
});
