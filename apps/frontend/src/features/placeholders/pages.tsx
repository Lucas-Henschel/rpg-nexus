/**
 * Áreas dos outros integrantes. Cada página diz o que vai existir ali e quais chamadas a tela vai usar,
 * para quem for implementar ter um ponto de partida. Ao implementar, mova a página para
 * src/features/<area>/ e crie o adaptador em src/api/<area>.ts, como em src/api/characters.ts.
 */
import { useServiceHealth } from "../../api/health";
import { services, type ServiceKey } from "../../config";
import { Link } from "../../router";

interface Props {
  title: string;
  lead: string;
  service: ServiceKey;
  planned: string[];
  endpoints: string[];
}

function ComingSoon({ title, lead, service, planned, endpoints }: Props) {
  const health = useServiceHealth()[service];
  const info = services[service];
  return (
    <main className="page page--narrow">
      <h1 className="page__title">{title}</h1>
      <p className="page__lead">{lead}</p>
      <div className="blueprint">
        <p className="blueprint__state">
          Esta tela ainda não foi construída. O serviço de {info.name} ({info.stack}) está{" "}
          {health === "up" ? "no ar" : health === "down" ? "fora do ar" : "sendo verificado"} em{" "}
          {info.url}.
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

export function CampaignsPage() {
  return (
    <ComingSoon
      title="Campanhas"
      lead="Onde quem mestra abre a campanha e reúne os personagens que vão jogar."
      service="campaigns"
      planned={[
        "Lista de campanhas e botão para criar uma nova",
        "Participantes de cada campanha",
        "Atividade recente: itens que os personagens conquistaram",
      ]}
      endpoints={["POST /campaigns", "GET /campaigns/{id}", "POST /campaigns/{id}/members"]}
    />
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
        "POST /items",
        "POST /stocks",
        "POST /acquisitions (responde 202 com operationId)",
        "GET /acquisitions/{operationId}",
        "GET /inventory/{characterId}",
      ]}
    />
  );
}

export function HistoryPage() {
  return (
    <ComingSoon
      title="Histórico"
      lead="A linha do tempo da campanha: quem ganhou o quê, e o que foi cancelado."
      service="actions"
      planned={[
        "Linha do tempo com cada item entregue e cada pedido cancelado",
        "Rolagem de dados simples, se sobrar tempo",
      ]}
      endpoints={["GET /campaigns/{id}/history", "POST /rolls"]}
    />
  );
}
