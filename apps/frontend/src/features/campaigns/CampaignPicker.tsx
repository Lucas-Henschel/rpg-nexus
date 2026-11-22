/** Escolha da campanha em uso, entre as campanhas de que a pessoa logada participa no S1. */
import { useEffect, useState, type FormEvent } from "react";
import { CAMPAIGN_PATTERN } from "../../shared/campaign";
import { errorMessage } from "../../shared/http";
import { useCampaigns } from "./queries";

interface Props {
  userId: string;
  value: string;
  onChange: (id: string) => void;
}

export function CampaignPicker({ userId, value, onChange }: Props) {
  const campaigns = useCampaigns(userId);
  const items = campaigns.data ?? [];
  const known = items.some((campaign) => campaign.campaignId === value);
  const first = items[0]?.campaignId;

  // Corrige seleção antiga ou inválida; se não houver campanhas, limpa o ID persistido.
  useEffect(() => {
    if (!campaigns.isSuccess) return;
    if (!items.length && value) {
      onChange("");
    } else if (first && !known) {
      onChange(first);
    }
  }, [campaigns.isSuccess, first, items.length, known, onChange, value]);

  if (campaigns.isError) {
    return <TypedCampaign value={value} onChange={onChange} problem={campaigns.error} />;
  }

  const emptyLabel = campaigns.isPending
    ? "Carregando campanhas…"
    : items.length
      ? "Selecione uma campanha"
      : "Você ainda não participa de campanhas";

  return (
    <div className="campaign-picker">
      <label htmlFor="campaign">Campanha</label>
      <select
        id="campaign"
        className="felt-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={campaigns.isPending || (campaigns.isSuccess && items.length === 0)}
      >
        {!known && value && (
          <option value={value}>
            {campaigns.isSuccess ? "Campanha anterior indisponível" : value}
          </option>
        )}
        {!known && !value && <option value="">{emptyLabel}</option>}
        {items.map((campaign) => (
          <option key={campaign.campaignId} value={campaign.campaignId}>
            {campaign.name} · {campaign.joinCode}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Sem o serviço de Campanhas, a pessoa ainda pode digitar o código. */
function TypedCampaign({ value, onChange, problem }: { value: string; onChange: (id: string) => void; problem: unknown }) {
  const [draft, setDraft] = useState(value);
  const valid = CAMPAIGN_PATTERN.test(draft.trim());

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) {
      onChange(draft.trim());
    }
  };

  return (
    <>
      <form className="campaign-picker" onSubmit={submit}>
        <label htmlFor="campaign">Campanha</label>
        <input
          id="campaign"
          className="felt-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
        {draft.trim() !== value && (
          <button
            type="submit"
            className="button button--ghost-felt button--small"
            disabled={!valid}
          >
            Trocar campanha
          </button>
        )}
      </form>
      <p className="field-error field-error--felt">
        {valid
          ? errorMessage(problem, "Não foi possível carregar as campanhas.")
          : "Use só letras, números, hífen e sublinhado."}
      </p>
    </>
  );
}