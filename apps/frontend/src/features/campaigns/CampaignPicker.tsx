/** Escolha da campanha em uso, entre as campanhas de que a pessoa logada participa no S1. */
import { useEffect, useState, type FormEvent } from "react";
import { CAMPAIGN_PATTERN } from "../../shared/campaign";
import { errorMessage } from "../../shared/http";
import { useCampaigns } from "./queries";

interface Props {
  value: string;
  onChange: (id: string) => void;
}

export function CampaignPicker({ value, onChange }: Props) {
  const campaigns = useCampaigns();

  const items = campaigns.data ?? [];
  // A campanha em uso pode não ser da pessoa (código antigo, outra conta) ou a lista ainda carrega.
  const known = items.some((campaign) => campaign.campaignId === value);
  const first = items[0]?.campaignId;

  // Campanha lembrada que não é desta pessoa: passa para a primeira dela.
  useEffect(() => {
    if (campaigns.isSuccess && !known && first) {
      onChange(first);
    }
  }, [campaigns.isSuccess, known, first, onChange]);

  if (campaigns.isError) {
    return <TypedCampaign value={value} onChange={onChange} problem={campaigns.error} />;
  }

  return (
    <div className="campaign-picker">
      <label htmlFor="campaign">Campanha</label>
      <select
        id="campaign"
        className="felt-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={campaigns.isPending}
      >
        {!known && (
          <option value={value}>
            {value}
            {campaigns.isSuccess ? " (você não participa)" : ""}
          </option>
        )}
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
function TypedCampaign({ value, onChange, problem }: Props & { problem: unknown }) {
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
