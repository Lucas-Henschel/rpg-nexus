import { Link } from "../../app/router";
import { useCampaign } from "../../shared/campaign";
import { errorMessage } from "../../shared/http";
import { CampaignPicker } from "../campaigns/CampaignPicker";
import { formatDateTime } from "../campaigns/format";
import type { HistoryEntry } from "./api";
import { useHistory } from "./queries";

const REASONS: Record<NonNullable<HistoryEntry["reason"]>, string> = {
  CHARACTER_REJECTED: "O personagem não pôde receber o item",
  EXTERNAL_VALIDATION_FAILED: "A validação externa recusou o pedido",
  DEADLINE_EXPIRED: "O prazo da operação terminou",
  PAYMENT_REJECTED: "O personagem não possuía saldo suficiente",
  LEFT: "O participante saiu da campanha",
  REMOVED: "O participante foi removido da campanha",
};

const TITLES: Record<HistoryEntry["type"], string> = {
  CAMPAIGN_CREATED: "Campanha criada",
  MEMBER_JOINED: "Participante entrou",
  MEMBER_REMOVED: "Participante saiu",
  SHOP_ITEM_PURCHASED: "Compra realizada",
  ITEM_ACQUIRED: "Item entregue",
  ACQUISITION_CANCELLED: "Pedido cancelado",
};

function description(entry: HistoryEntry): string {
  switch (entry.type) {
    case "CAMPAIGN_CREATED":
      return `${entry.ownerName ?? "O mestre"} criou a campanha ${entry.campaignName ?? entry.campaignId}.`;
    case "MEMBER_JOINED":
      return `${entry.username ?? entry.userId ?? "Um participante"} entrou como ${entry.role === "OWNER" ? "mestre" : "jogador"}.`;
    case "MEMBER_REMOVED":
      return REASONS[entry.reason ?? "REMOVED"];
    case "SHOP_ITEM_PURCHASED":
      return `${entry.characterId ?? "O personagem"} comprou ${entry.quantity ?? 1}× ${entry.itemName ?? entry.itemId ?? "item"}${entry.amount !== undefined ? ` por ${entry.amount}` : ""}.`;
    case "ITEM_ACQUIRED":
      return `${entry.characterId ?? "O personagem"} recebeu ${entry.quantity ?? 1}× ${entry.itemName ?? entry.itemId ?? "item"}.`;
    case "ACQUISITION_CANCELLED": {
      const reason = entry.reason ? REASONS[entry.reason] : "A entrega do item foi cancelada";
      return entry.detail ? `${reason}: ${entry.detail}` : `${reason}.`;
    }
  }
}

export function HistoryPage() {
  const [campaignId, setCampaignId] = useCampaign();
  const history = useHistory(campaignId);

  return (
    <main className="page page--narrow">
      <header className="page__head history-head">
        <div>
          <h1 className="page__title">Histórico</h1>
          <p className="page__lead">Acontecimentos registrados durante a campanha.</p>
        </div>
        <CampaignPicker value={campaignId} onChange={setCampaignId} />
      </header>

      {history.isPending && <p className="history-state">Carregando a linha do tempo.</p>}
      {history.isError && (
        <div className="history-state history-state--error" role="alert">
          <p>{errorMessage(history.error, "Não foi possível carregar o histórico.")}</p>
          <button className="button button--ghost-felt button--small" onClick={() => void history.refetch()}>
            Tentar novamente
          </button>
        </div>
      )}
      {history.isSuccess && history.data.length === 0 && (
        <div className="history-state">
          <h2>Nenhum acontecimento ainda</h2>
          <p>Quando houver uma atividade na campanha, ela aparecerá aqui.</p>
          <Link to="/itens" className="button button--brass">
            Ir para os itens
          </Link>
        </div>
      )}
      {history.isSuccess && history.data.length > 0 && (
        <ol className="history-timeline" aria-label="Linha do tempo da campanha">
          {history.data.map((entry) => (
            <li
              key={`${entry.occurredAt}-${entry.type}-${entry.operationId ?? entry.userId ?? entry.campaignId}`}
              className={`history-entry history-entry--${entry.type.toLowerCase()}`}
            >
              <span className="history-entry__mark" aria-hidden="true" />
              <article>
                <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
                <h2>{TITLES[entry.type]}</h2>
                <p>{description(entry)}</p>
                {entry.operationId && <small>Operação {entry.operationId}</small>}
              </article>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
