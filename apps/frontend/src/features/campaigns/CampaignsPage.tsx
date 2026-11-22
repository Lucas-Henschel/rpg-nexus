import { useState, type FormEvent } from "react";
import { navigate } from "../../app/navigation";
import { useCampaign } from "../../shared/campaign";
import { errorMessage } from "../../shared/http";
import { useToast } from "../../shared/ui/toast-context";
import { useAuth } from "../auth/auth-context";
import type { Campaign } from "./api";
import { formatDate } from "./format";
import { useCampaigns, useCreateCampaign, useJoinCampaign } from "./queries";

const JOIN_CODE = /^\d{6}$/;

export function CampaignsPage() {
  const { user } = useAuth();
  const campaigns = useCampaigns(user?.userId ?? "");
  const [, setCampaign] = useCampaign(user?.userId);

  // Abrir uma campanha também a torna a campanha em uso nas outras telas.
  const open = (campaign: Campaign) => {
    setCampaign(campaign.campaignId);
    navigate(`/campanhas/${encodeURIComponent(campaign.campaignId)}`);
  };

  return (
    <main className="page">
      <h1 className="page__title">Campanhas</h1>
      <p className="page__lead">
        Quem mestra cria a campanha e passa o código de seis dígitos; quem joga entra com ele.
      </p>

      <NewCampaignForm onCreated={open} />
      <JoinCampaignForm onJoined={open} />

      {campaigns.isPending && <p className="page__status">Buscando as suas campanhas…</p>}

      {campaigns.isError && (
        <div className="notice">
          <p>{errorMessage(campaigns.error, "Não foi possível carregar as campanhas.")}</p>
          <button
            type="button"
            className="button button--ghost-felt"
            onClick={() => void campaigns.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {campaigns.isSuccess && campaigns.data.length === 0 && (
        <div className="notice">
          <p>Você ainda não participa de nenhuma campanha. Crie uma ou entre com um código.</p>
        </div>
      )}

      {campaigns.isSuccess && campaigns.data.length > 0 && (
        <ul className="campaign-cards">
          {campaigns.data.map((campaign) => (
            <li key={campaign.campaignId}>
              <button type="button" className="campaign-card" onClick={() => open(campaign)}>
                <span className="campaign-card__name">{campaign.name}</span>
                <span className="campaign-card__meta">
                  Código {campaign.joinCode} ·{" "}
                  {campaign.ownerId === user?.userId ? "Você mestra" : `Mestre: ${campaign.ownerName}`}
                </span>
                <span className="campaign-card__meta">
                  Criada em {formatDate(campaign.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function NewCampaignForm({ onCreated }: { onCreated: (campaign: Campaign) => void }) {
  const toast = useToast();
  const create = useCreateCampaign();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setProblem("Dê um nome à campanha.");

      return;
    }

    setProblem(null);
    try {
      const created = await create.mutateAsync(name.trim());
      toast("ok", `Campanha ${created.name} criada. Código de entrada: ${created.joinCode}.`);
      onCreated(created);
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível criar a campanha."));
    }
  };

  return (
    <form className="campaign-form" onSubmit={(e) => void submit(e)} noValidate>
      <label className="campaign-form__field campaign-form__field--wide">
        <span>Nome da nova campanha</span>
        <input
          className="felt-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
      </label>
      <button type="submit" className="button button--brass" disabled={create.isPending}>
        {create.isPending ? "Criando…" : "Criar campanha"}
      </button>
      {problem && <p className="field-error field-error--felt campaign-form__problem">{problem}</p>}
    </form>
  );
}

function JoinCampaignForm({ onJoined }: { onJoined: (campaign: Campaign) => void }) {
  const toast = useToast();
  const join = useJoinCampaign();
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!JOIN_CODE.test(code)) {
      setProblem("O código tem seis algarismos.");

      return;
    }

    setProblem(null);
    try {
      const campaign = await join.mutateAsync(code);
      toast("ok", `Você está na campanha ${campaign.name}.`);
      setCode("");
      onJoined(campaign);
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível entrar na campanha."));
    }
  };

  return (
    <form className="campaign-form" onSubmit={(e) => void submit(e)} noValidate>
      <label className="campaign-form__field">
        <span>Entrar com código</span>
        <input
          className="felt-input"
          value={code}
          // Só algarismos, no máximo seis.
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="submit" className="button button--ghost-felt" disabled={join.isPending}>
        {join.isPending ? "Entrando…" : "Entrar"}
      </button>
      {problem && <p className="field-error field-error--felt campaign-form__problem">{problem}</p>}
    </form>
  );
}
