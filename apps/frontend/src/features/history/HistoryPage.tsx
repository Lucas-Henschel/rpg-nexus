import { useState } from "react";
import { Link } from "../../app/router";
import { useCampaign } from "../../shared/campaign";
import { errorMessage } from "../../shared/http";
import { CampaignPicker } from "../campaigns/CampaignPicker";
import { formatDateTime } from "../campaigns/format";
import { description, TITLES } from "./format";
import { useHistory } from "./queries";
import { useAuth } from "../auth/auth-context";
import { useCampaigns, useCampaignView } from "../campaigns/queries";

export function HistoryPage() {
  const { user } = useAuth();
  const userId = user?.userId ?? "";
  const campaigns = useCampaigns(userId);
  const [storedCampaignId, setCampaignId] = useCampaign(user?.userId);
  let campaignId = "";
  if (campaigns.isSuccess) {
    campaignId = campaigns.data.find((item) => item.campaignId === storedCampaignId)?.campaignId ?? campaigns.data[0]?.campaignId ?? "";
  } else if (campaigns.isError) {
    campaignId = storedCampaignId;
  }

  const history = useHistory(campaignId);
  const campaign = useCampaignView(campaignId);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const names = new Map(campaign.data?.members.filter(member => member.characterId).map(member => [member.characterId!, member.characterName ?? member.username]) ?? []);

  return (
    <main className="page page--narrow">
      <header className="page__head history-head">
        <div>
          <h1 className="page__title">Histórico</h1>
          <p className="page__lead">Acontecimentos registrados durante a campanha.</p>
        </div>
        <CampaignPicker userId={userId} value={campaignId} onChange={id => { setCampaignId(id); setPage(1); }} />
      </header>

      {!campaignId && campaigns.isPending && <p className="history-state">Carregando suas campanhas.</p>}
      {campaigns.isSuccess && campaigns.data.length === 0 && <div className="history-state"><h2>Você ainda não participa de nenhuma campanha</h2><p>Crie uma campanha ou entre com um código para consultar o histórico.</p><Link to="/campanhas" className="button button--brass">Ver campanhas</Link></div>}
      {history.isPending && campaignId && <p className="history-state">Carregando a linha do tempo.</p>}
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
          {history.data.slice((page - 1) * pageSize, page * pageSize).map((entry) => (
            <li
              key={`${entry.occurredAt}-${entry.type}-${entry.operationId ?? entry.userId ?? entry.campaignId}`}
              className={`history-entry history-entry--${entry.type.toLowerCase()}`}
            >
              <span className="history-entry__mark" aria-hidden="true" />
              <article>
                <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
                <h2>{TITLES[entry.type]}</h2>
                <p>{description(entry, names)}</p>
              </article>
            </li>
          ))}
        </ol>
      )}
      {history.isSuccess && history.data.length > 0 && <div className="list-pagination"><label>Atividades por página <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label><button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button><span>Página {page} de {Math.ceil(history.data.length / pageSize)}</span><button type="button" disabled={page * pageSize >= history.data.length} onClick={() => setPage(page + 1)}>Próxima</button></div>}
    </main>
  );
}
