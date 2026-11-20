import { useState, type FormEvent } from "react";
import { navigate } from "../../app/navigation";
import { Link } from "../../app/router";
import { errorMessage } from "../../shared/http";
import { useToast } from "../../shared/ui/toast-context";
import { useAuth } from "../auth/auth-context";
import { useCharacters, useTemplates } from "../characters/queries";
import { CampaignShop } from "../inventory/CampaignShop";
import type { CampaignView, Member } from "./api";
import { formatDate, formatDateTime } from "./format";
import { useAssignTemplate, useCampaignView, useChooseCharacter, useRemoveMember } from "./queries";

const ROLE_LABEL = { OWNER: "Mestre", PLAYER: "Jogador" } as const;

export function CampaignPage({ id }: { id: string }) {
  const campaign = useCampaignView(id);

  return (
    <main className="page">
      <Link to="/campanhas" className="back-link">
        Voltar às campanhas
      </Link>

      {campaign.isPending && <p className="page__status">Buscando a campanha…</p>}

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
  const { user } = useAuth();
  const me = campaign.members.find((member) => member.userId === user?.userId);
  const isOwner = me?.role === "OWNER";
  const names = new Map(
    campaign.members
      .filter((member) => member.characterId)
      .map((member) => [member.characterId, member.characterName ?? member.username]),
  );

  return (
    <>
      <h1 className="page__title">{campaign.name}</h1>
      <p className="page__lead">
        Código de entrada <strong>{campaign.joinCode}</strong> · Mestre: {campaign.ownerName} ·
        Criada em {formatDate(campaign.createdAt)}
      </p>
      <p className="page__lead">
        Modelo de ficha:{" "}
        {campaign.template ? (
          <strong>
            {campaign.template.name} (versão {campaign.template.version})
          </strong>
        ) : (
          "nenhum definido"
        )}
      </p>
      {isOwner && <TemplateForm campaign={campaign} />}

      <div className="campaign-columns">
        <section className="paper">
          <h2 className="sheet__heading">Participantes</h2>
          <ul className="campaign-list">
            {campaign.members.map((member) => (
              <MemberRow
                key={member.userId}
                campaignId={campaign.campaignId}
                member={member}
                isMe={member.userId === user?.userId}
                canRemove={isOwner && member.role === "PLAYER"}
              />
            ))}
          </ul>
          {me && <CharacterForm campaign={campaign} me={me} />}
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
                    {activity.quantity}× {activity.itemName ?? "item"}
                  </span>
                  <span className="campaign-list__side">{formatDateTime(activity.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      {me && <CampaignShop campaignId={campaign.campaignId} member={me} />}
    </>
  );
}

interface MemberRowProps {
  campaignId: string;
  member: Member;
  isMe: boolean;
  canRemove: boolean;
}

/** Um participante; o jogador logado pode sair, e o mestre pode remover jogadores. */
function MemberRow({ campaignId, member, isMe, canRemove }: MemberRowProps) {
  const toast = useToast();
  const remove = useRemoveMember(campaignId);
  const leaving = isMe && member.role === "PLAYER";

  const run = async () => {
    const question = leaving ? "Sair desta campanha?" : `Remover ${member.username} da campanha?`;
    if (!window.confirm(question)) {
      return;
    }

    try {
      await remove.mutateAsync(member.userId);
      if (leaving) {
        toast("ok", "Você saiu da campanha.");
        navigate("/campanhas");
      } else {
        toast("ok", `${member.username} foi removido.`);
      }
    } catch (error) {
      toast("error", errorMessage(error, "Não foi possível remover o participante."));
    }
  };

  const items = member.itemsAcquired === 1 ? "1 item" : `${member.itemsAcquired} itens`;

  return (
    <li className="campaign-list__row">
      <span className="campaign-list__main">
        {member.username}
        {isMe && " (você)"} · {ROLE_LABEL[member.role]}
        <br />
        <small>{member.characterName ?? "sem personagem"}</small>
      </span>
      <span className="campaign-list__side">
        {items}
        {(leaving || canRemove) && (
          <>
            {" · "}
            <button
              type="button"
              className="text-button"
              onClick={() => void run()}
              disabled={remove.isPending}
            >
              {leaving ? "Sair" : "Remover"}
            </button>
          </>
        )}
      </span>
    </li>
  );
}

/** O personagem que a pessoa logada usa na campanha, entre os personagens da campanha no S2. */
function CharacterForm({ campaign, me }: { campaign: CampaignView; me: Member }) {
  const toast = useToast();
  const characters = useCharacters(campaign.campaignId);
  const choose = useChooseCharacter(campaign.campaignId);
  const [chosen, setChosen] = useState(me.characterId ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const takenByOthers = new Set(
    campaign.members
      .filter((member) => member.userId !== me.userId && member.characterId)
      .map((member) => member.characterId),
  );
  const available = (characters.data ?? []).filter((character) => !takenByOthers.has(character.id));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const character = available.find((item) => item.id === chosen);
    if (!character) {
      return;
    }

    setProblem(null);
    try {
      await choose.mutateAsync({ characterId: character.id, characterName: character.name });
      toast("ok", `Você joga com ${character.name}.`);
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível escolher o personagem."));
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
        Nenhum personagem livre nesta campanha.{" "}
        <Link to="/personagens/novo" className="text-button">
          Criar personagem
        </Link>
      </p>
    );
  }

  return (
    <form className="campaign-add" onSubmit={(e) => void submit(e)}>
      <label htmlFor="my-character">Seu personagem</label>
      <select
        id="my-character"
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
        disabled={!chosen || chosen === me.characterId || choose.isPending}
      >
        Usar
      </button>
      {problem && <p className="field-error">{problem}</p>}
    </form>
  );
}

/** Só o mestre: o modelo de ficha da campanha, entre os modelos salvos por ele. */
function TemplateForm({ campaign }: { campaign: CampaignView }) {
  const toast = useToast();
  const templates = useTemplates();
  const assign = useAssignTemplate(campaign.campaignId);
  const current = campaign.template?.templateId ?? "";
  const [chosen, setChosen] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!chosen) {
      return;
    }

    setProblem(null);
    try {
      const updated = await assign.mutateAsync(chosen);
      toast("ok", `Os jogadores usam o modelo ${updated.template?.name ?? ""}.`);
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível definir o modelo."));
    }
  };

  if (templates.isError) {
    return (
      <p className="campaign-empty">
        {errorMessage(templates.error, "Não foi possível carregar seus modelos.")}
      </p>
    );
  }

  if (templates.isSuccess && templates.data.length === 0) {
    return (
      <p className="campaign-empty">
        Você ainda não tem modelos de ficha. Salve um a partir de uma ficha para usá-lo aqui.
      </p>
    );
  }

  // Mesmo modelo, mas editado depois da escolha: definir de novo passa a usar a versão atual.
  const latest = templates.data?.find((item) => item.templateId === chosen)?.version;
  const unchanged = chosen === current && latest === campaign.template?.version;

  return (
    <form className="campaign-add" onSubmit={(e) => void submit(e)}>
      <label htmlFor="campaign-template">Modelo de ficha</label>
      <select
        id="campaign-template"
        className="ink-input"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
        disabled={templates.isPending}
      >
        <option value="">{templates.isPending ? "Carregando…" : "Escolha um modelo"}</option>
        {templates.data?.map((item) => (
          <option key={item.templateId} value={item.templateId}>
            {item.name} (versão {item.version})
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="button button--ink button--small"
        disabled={!chosen || unchanged || assign.isPending}
      >
        Definir
      </button>
      {problem && <p className="field-error">{problem}</p>}
    </form>
  );
}
