import { useState, type FormEvent } from "react";
import { navigate } from "../../app/navigation";
import { CAMPAIGN_PATTERN, useCampaign } from "../../shared/campaign";
import { errorMessage } from "../../shared/http";
import { useToast } from "../../shared/ui/toast-context";
import type { Campaign } from "./api";
import { formatDate } from "./format";
import { useCampaigns, useCreateCampaign } from "./queries";

export function CampaignsPage() {
  const campaigns = useCampaigns();
  const [, setCampaign] = useCampaign();

  // Abrir uma campanha também a torna a campanha em uso nas outras telas.
  const open = (campaign: Campaign) => {
    setCampaign(campaign.campaignId);
    navigate(`/campanhas/${encodeURIComponent(campaign.campaignId)}`);
  };

  return (
    <main className="page">
      <h1 className="page__title">Campanhas</h1>
      <p className="page__lead">
        Onde quem mestra abre a campanha e reúne os personagens que vão jogar.
      </p>

      <NewCampaignForm onCreated={open} />

      {campaigns.isPending && <p className="page__status">Buscando as campanhas…</p>}

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
          <p>Nenhuma campanha cadastrada ainda. Crie a primeira acima.</p>
        </div>
      )}

      {campaigns.isSuccess && campaigns.data.length > 0 && (
        <ul className="campaign-cards">
          {campaigns.data.map((campaign) => (
            <li key={campaign.campaignId}>
              <button type="button" className="campaign-card" onClick={() => open(campaign)}>
                <span className="campaign-card__name">{campaign.name}</span>
                <span className="campaign-card__meta">
                  Código {campaign.campaignId}
                  {campaign.gameMaster && ` · Mestre: ${campaign.gameMaster}`}
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
  const [gameMaster, setGameMaster] = useState("");
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setProblem("Dê um nome à campanha.");

      return;
    }

    if (code.trim() && !CAMPAIGN_PATTERN.test(code.trim())) {
      setProblem("No código, use só letras, números, hífen e sublinhado.");

      return;
    }

    setProblem(null);
    try {
      const created = await create.mutateAsync({
        name: name.trim(),
        gameMaster: gameMaster.trim() || undefined,
        campaignId: code.trim() || undefined,
      });
      toast("ok", `Campanha ${created.name} criada.`);
      onCreated(created);
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível criar a campanha."));
    }
  };

  return (
    <form className="campaign-form" onSubmit={(e) => void submit(e)} noValidate>
      <label className="campaign-form__field campaign-form__field--wide">
        <span>Nome da campanha</span>
        <input
          className="felt-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
      </label>
      <label className="campaign-form__field">
        <span>Mestre (opcional)</span>
        <input
          className="felt-input"
          value={gameMaster}
          onChange={(e) => setGameMaster(e.target.value)}
          maxLength={80}
        />
      </label>
      <label className="campaign-form__field">
        <span>Código (opcional)</span>
        <input
          className="felt-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="ex.: c1"
          spellCheck={false}
          maxLength={64}
        />
      </label>
      <button type="submit" className="button button--brass" disabled={create.isPending}>
        {create.isPending ? "Criando…" : "Criar campanha"}
      </button>
      {problem && <p className="field-error field-error--felt campaign-form__problem">{problem}</p>}
    </form>
  );
}
