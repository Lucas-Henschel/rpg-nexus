import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { navigate } from "../../app/navigation";
import { Link } from "../../app/router";
import { errorMessage, isMembershipPending, MEMBERSHIP_GIVE_UP_MESSAGE, retryWhileMembershipPending } from "../../shared/http";
import { useToast } from "../../shared/ui/toast-context";
import { useAuth } from "../auth/auth-context";
import { characterKeys, useCharacters, useTemplates } from "../characters/queries";
import { assignCharacterCampaign, PERSONAL_CAMPAIGN } from "../characters/api";
import { CampaignShop } from "../inventory/CampaignShop";
import { description, TITLES } from "../history/format";
import { useHistory } from "../history/queries";
import type { CampaignView, Member } from "./api";
import { formatDate, formatDateTime } from "./format";
import { useAssignTemplate, useCampaignView, useChooseCharacter, useRemoveMember } from "./queries";

const ROLE_LABEL = { OWNER: "Mestre", PLAYER: "Jogador" } as const;

export function CampaignPage({ id }: { id: string }) {
  const campaign = useCampaignView(id);

  return (
    <main className="page page--campaign">
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
  const history = useHistory(campaign.campaignId);
  const [activityPage, setActivityPage] = useState(1);
  const [activitySize, setActivitySize] = useState(20);
  const me = campaign.members.find((member) => member.userId === user?.userId);
  const [characterPromptDismissed, setCharacterPromptDismissed] = useState(false);
  const showCharacterPrompt = me?.role === "PLAYER" && !me.characterId && !characterPromptDismissed;
  const isOwner = me?.role === "OWNER";
  const names = new Map(
    campaign.members
      .filter((member) => member.characterId)
      .map((member) => [member.characterId!, member.characterName ?? member.username] as const),
  );

  return (
    <>
      <header className="campaign-topbar">
        <div className="campaign-topbar__intro">
          <div>
            <span className="campaign-topbar__eyebrow">Campanha</span>
            <h1 className="page__title">{campaign.name}</h1>
          </div>
          <div className="campaign-topbar__meta">
            <span>Código <strong>{campaign.joinCode}</strong></span>
            <span>Mestre <strong>{campaign.ownerName}</strong></span>
            <span>Criada em {formatDate(campaign.createdAt)}</span>
          </div>
        </div>
        <div className="campaign-topbar__template">
          <span>Modelo de ficha</span>
          <strong>{campaign.template ? `${campaign.template.name} · versão ${campaign.template.version}` : "Nenhum definido"}</strong>
          {isOwner && <TemplateForm campaign={campaign} />}
        </div>
      </header>

      <section className="paper campaign-participants">
          <h2 className="sheet__heading">Participantes <span className="campaign-count">{campaign.members.length}</span></h2>
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

      <div className="campaign-columns">
        <div className="campaign-shop-space">{me && <CampaignShop campaignId={campaign.campaignId} member={me} />}</div>
        <section className="paper">
          <h2 className="sheet__heading">Atividade recente <span className="campaign-count">{history.data?.length ?? 0}</span></h2>
          {history.isPending ? <p className="campaign-empty">Carregando atividades…</p> : null}
          {history.isError ? <p className="campaign-empty">Não foi possível carregar o histórico. <button type="button" className="text-button" onClick={() => void history.refetch()}>Tentar de novo</button></p> : null}
          {history.isSuccess && history.data.length === 0 ? (
            <p className="campaign-empty">Nenhuma atividade registrada ainda.</p>
          ) : history.isSuccess && (
            <ul className="campaign-list">
              {history.data?.slice((activityPage - 1) * activitySize, activityPage * activitySize).map((activity, index) => (
                <li key={`${activity.occurredAt}-${activity.type}-${index}`} className="campaign-list__row">
                  <span className="campaign-list__main">
                    <strong>{TITLES[activity.type]}</strong><br />{description(activity, names)}
                  </span>
                  <span className="campaign-list__side">{formatDateTime(activity.occurredAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {history.data && history.data.length > 0 && <div className="list-pagination"><label>Por página <select value={activitySize} onChange={e => { setActivitySize(Number(e.target.value)); setActivityPage(1); }}><option value="10">10</option><option value="20">20</option><option value="50">50</option></select></label><button type="button" disabled={activityPage === 1} onClick={() => setActivityPage(activityPage - 1)}>Anterior</button><span>{activityPage}/{Math.ceil(history.data.length / activitySize)}</span><button type="button" disabled={activityPage * activitySize >= history.data.length} onClick={() => setActivityPage(activityPage + 1)}>Próxima</button></div>}
        </section>
      </div>
      {showCharacterPrompt && me && <div className="character-modal-backdrop" role="presentation">
        <section className="paper character-modal" role="dialog" aria-modal="true" aria-labelledby="character-modal-title">
          <h2 id="character-modal-title" className="sheet__heading">Escolha seu personagem</h2>
          <p>Selecione quem vai jogar nesta campanha. Você pode criar um personagem pessoal e adicioná-lo agora.</p>
          <CharacterForm campaign={campaign} me={me} onChosen={() => setCharacterPromptDismissed(true)} />
          <button type="button" className="button button--ghost-ink" onClick={() => setCharacterPromptDismissed(true)}>Escolher depois</button>
        </section>
      </div>}
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
function CharacterForm({ campaign, me, onChosen }: { campaign: CampaignView; me: Member; onChosen?: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const characters = useCharacters(campaign.campaignId);
  const personal = useCharacters(PERSONAL_CAMPAIGN);
  const choose = useChooseCharacter(campaign.campaignId);
  const [chosen, setChosen] = useState(me.characterId ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const takenByOthers = new Set(
    campaign.members
      .filter((member) => member.userId !== me.userId && member.characterId)
      .map((member) => member.characterId),
  );
  const available = [...(characters.data ?? []), ...(personal.data ?? [])]
    .filter((character) => character.ownerId === me.userId && !takenByOthers.has(character.id));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const character = available.find((item) => item.id === chosen);
    if (!character) {
      return;
    }

    setProblem(null);
    setSaving(true);
    try {
      if (character.campaignId === PERSONAL_CAMPAIGN) {
        await retryWhileMembershipPending(() => assignCharacterCampaign(character.id, campaign.campaignId));
        await queryClient.invalidateQueries({ queryKey: ["characters", "list"] });
        await queryClient.invalidateQueries({ queryKey: characterKeys.detail(character.id) });
      }

      await choose.mutateAsync({ characterId: character.id, characterName: character.name });
      toast("ok", `Você joga com ${character.name}.`);
      onChosen?.();
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível escolher o personagem."));
    } finally {
      setSaving(false);
    }
  };

  // Logo depois de criar ou entrar na campanha, o S2 pode ainda não saber disso: a consulta repete
  // sozinha por alguns segundos (queryClient) e, se não der, a pessoa tenta de novo pelo botão.
  if (characters.isPending && isMembershipPending(characters.failureReason)) {
    return <p className="campaign-empty">Confirmando sua entrada na campanha…</p>;
  }

  if (characters.isError) {
    return (
      <p className="campaign-empty">
        {isMembershipPending(characters.error)
          ? MEMBERSHIP_GIVE_UP_MESSAGE
          : errorMessage(characters.error, "Não foi possível carregar os personagens da campanha.")}{" "}
        <button type="button" className="text-button" onClick={() => void characters.refetch()}>
          Tentar de novo
        </button>
      </p>
    );
  }

  if (characters.isSuccess && personal.isSuccess && available.length === 0) {
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
      <div id="my-character" className="choice-grid" role="group" aria-label="Escolha seu personagem">
        {available.map(character => <button type="button" key={character.id}
          className={`choice-card${chosen === character.id ? " choice-card--selected" : ""}`}
          onClick={() => setChosen(character.id)}>{character.name}</button>)}
      </div>
      <button
        type="submit"
        className="button button--ink button--small"
        disabled={!chosen || chosen === me.characterId || saving}
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
      <div id="campaign-template" className="choice-grid" role="group" aria-label="Escolha o modelo de ficha">
        {templates.data?.map(item => <button type="button" key={item.templateId}
          className={`choice-card${chosen === item.templateId ? " choice-card--selected" : ""}`}
          onClick={() => setChosen(item.templateId)}>{item.name} <small>Versão {item.version}</small></button>)}
      </div>
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
