import { useState, type FormEvent } from "react";
import { Link } from "../../app/router";
import { errorMessage } from "../../shared/http";
import { useToast } from "../../shared/ui/toast-context";
import { useCharacters } from "../characters/queries";
import type { CampaignView, Member } from "./api";
import { formatDate, formatDateTime } from "./format";
import { useAddMember, useCampaignView } from "./queries";

/** Nome para mostrar: quem entrou sozinho, ao conquistar um item, ainda não tem nome. */
const memberName = (member: Member) => member.characterName ?? member.characterId;

export function CampaignPage({ id }: { id: string }) {
  const campaign = useCampaignView(id);

  return (
    <main className="page">
      <Link to="/campanhas" className="back-link">
        Voltar às campanhas
      </Link>

      {campaign.isPending && <p className="page__status">Buscando a campanha {id}…</p>}

      {campaign.isError && (
        <div className="notice">
          <p>
            {errorMessage(campaign.error, "Não foi possível carregar a campanha.")}
            {campaign.data && " Mostrando os últimos dados carregados."}
          </p>
          <button
            type="button"
            className="button button--ghost-felt"
            onClick={() => void campaign.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {/* Uma atualização em segundo plano que falha não apaga o que já estava na tela. */}
      {campaign.data && <CampaignDetail campaign={campaign.data} />}
    </main>
  );
}

function CampaignDetail({ campaign }: { campaign: CampaignView }) {
  const names = new Map(campaign.members.map((member) => [member.characterId, memberName(member)]));

  return (
    <>
      <h1 className="page__title">{campaign.name}</h1>
      <p className="page__lead">
        Código {campaign.campaignId}
        {campaign.gameMaster && ` · Mestre: ${campaign.gameMaster}`} · Criada em{" "}
        {formatDate(campaign.createdAt)}
      </p>

      <div className="campaign-columns">
        <section className="paper">
          <h2 className="sheet__heading">Participantes</h2>
          {campaign.members.length === 0 ? (
            <p className="campaign-empty">Ninguém participa ainda.</p>
          ) : (
            <ul className="campaign-list">
              {campaign.members.map((member) => (
                <li key={member.characterId} className="campaign-list__row">
                  <span className="campaign-list__main">{memberName(member)}</span>
                  <span className="campaign-list__side">
                    {member.itemsAcquired === 1 ? "1 item" : `${member.itemsAcquired} itens`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <AddMemberForm campaign={campaign} />
        </section>

        <section className="paper">
          <h2 className="sheet__heading">Atividade recente</h2>
          {campaign.recentActivity.length === 0 ? (
            <p className="campaign-empty">Nenhum item conquistado ainda.</p>
          ) : (
            <ul className="campaign-list">
              {campaign.recentActivity.map((activity) => (
                <li key={activity.operationId} className="campaign-list__row">
                  <span className="campaign-list__main">
                    {names.get(activity.characterId) ?? activity.characterId} conquistou{" "}
                    {activity.quantity}× {activity.itemName ?? activity.itemId}
                  </span>
                  <span className="campaign-list__side">{formatDateTime(activity.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Lista os personagens da campanha no S2 que ainda não participam. */
function AddMemberForm({ campaign }: { campaign: CampaignView }) {
  const toast = useToast();
  const characters = useCharacters(campaign.campaignId);
  const addMember = useAddMember(campaign.campaignId);
  const [chosen, setChosen] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const joined = new Set(campaign.members.map((member) => member.characterId));
  const available = (characters.data ?? []).filter((character) => !joined.has(character.id));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const character = available.find((item) => item.id === chosen);
    if (!character) {
      return;
    }

    setProblem(null);
    try {
      await addMember.mutateAsync({ characterId: character.id, characterName: character.name });
      toast("ok", `${character.name} entrou na campanha.`);
      setChosen("");
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível adicionar o participante."));
    }
  };

  if (characters.isError) {
    return (
      <p className="campaign-empty">
        {errorMessage(characters.error, "Não foi possível carregar os personagens da campanha.")}
      </p>
    );
  }

  if (characters.isSuccess && available.length === 0) {
    return (
      <p className="campaign-empty">
        Todos os personagens da campanha já participam.{" "}
        <Link to="/personagens/novo" className="text-button">
          Criar personagem
        </Link>
      </p>
    );
  }

  return (
    <form className="campaign-add" onSubmit={(e) => void submit(e)}>
      <label htmlFor="new-member">Adicionar participante</label>
      <select
        id="new-member"
        className="ink-input"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        disabled={characters.isPending}
      >
        <option value="">{characters.isPending ? "Carregando…" : "Escolha um personagem"}</option>
        {available.map((character) => (
          <option key={character.id} value={character.id}>
            {character.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="button button--ink button--small"
        disabled={!chosen || addMember.isPending}
      >
        Adicionar
      </button>
      {problem && <p className="field-error">{problem}</p>}
    </form>
  );
}
