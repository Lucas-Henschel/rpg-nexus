/**
 * Áreas dos outros integrantes. Cada página diz o que vai existir ali e quais chamadas a tela vai usar,
 * para quem for implementar ter um ponto de partida. Ao implementar, mova a página para
 * src/features/<area>/ e crie o adaptador em src/features/<area>/api.ts, como em
 * src/features/characters/api.ts.
 */
import { useServiceHealth, type Health } from "../../shared/health";
import { services, type ServiceKey } from "../../shared/config";
import { Link } from "../../app/router";

const HEALTH_TEXT: Record<Health, string> = {
  checking: "sendo verificado",
  up: "no ar",
  down: "fora do ar",
};

interface Props {
  title: string;
  lead: string;
  service: ServiceKey;
  planned: string[];
  endpoints: string[];
}

function ComingSoon({ title, lead, service, planned, endpoints }: Props) {
  const health = useServiceHealth(service);
  const info = services[service];

  return (
    <main className="page page--narrow">
      <h1 className="page__title">{title}</h1>
      <p className="page__lead">{lead}</p>
      <div className="blueprint">
        <p className="blueprint__state">
          Esta tela ainda não foi construída. O serviço de {info.name} ({info.stack}) está{" "}
          {HEALTH_TEXT[health]} em {info.url}.
        </p>
        <h2 className="blueprint__heading">O que vai aparecer aqui</h2>
        <ul className="blueprint__list">
          {planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <h2 className="blueprint__heading">Chamadas que a tela vai usar</h2>
        <ul className="blueprint__endpoints">
          {endpoints.map((item) => (
            <li key={item}>
              <code>{item}</code>
            </li>
          ))}
        </ul>
      </div>
      <Link to="/personagens" className="button button--ghost-felt">
        Ir para os personagens
      </Link>
    </main>
  );
}

export function ItemsPage() {
  return (
    <ComingSoon
      title="Itens"
      lead="O estoque da campanha e a disputa pelos itens raros."
      service="inventory"
      planned={[
        "Catálogo com o estoque restante de cada item",
        "Botão para pedir um item e acompanhamento do pedido até a entrega ou o cancelamento",
        "Inventário de cada personagem",
      ]}
      endpoints={[
        "GET /shops/{campaignId}/items",
        "POST /acquisitions (responde 202 com operationId)",
        "GET /acquisitions/{operationId}",
        "GET /inventory/{characterId}",
      ]}
    />
  );
}
