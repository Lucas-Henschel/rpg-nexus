/** Seletor de campanha usando os nomes legíveis do serviço de Campanhas. */
import { useRef, useState, type FormEvent } from "react";
import { CAMPAIGN_PATTERN } from "../../shared/campaign";
import { errorMessage } from "../../shared/http";
import { useCampaigns } from "./queries";

interface Props {
  userId: string;
  value: string;
  onChange: (id: string) => void;
  includePersonal?: boolean;
}

export function CampaignPicker({ userId, value, onChange, includePersonal = false }: Props) {
  const menu = useRef<HTMLDetailsElement>(null);
  const campaigns = useCampaigns(userId);
  const items = campaigns.data ?? [];

  if (campaigns.isError) {
    return <TypedCampaign value={value} onChange={onChange} problem={campaigns.error} />;
  }

  let emptyLabel = "Você ainda não participa de campanhas";
  if (campaigns.isPending) {
    emptyLabel = "Carregando campanhas…";
  } else if (items.length) {
    emptyLabel = "Selecione uma campanha";
  }

  const selected = items.find(item => item.campaignId === value);
  const label = includePersonal && value === "__personal__" ? "Meus personagens" :
    selected?.name ?? emptyLabel;

  return (
    <div className="campaign-picker">
      <span>{includePersonal ? "Destino da ficha" : "Campanha"}</span>
      <details className="campaign-menu" ref={menu}>
        <summary>{label}</summary>
        <div className="campaign-menu__options" role="group" aria-label="Escolher campanha">
          {includePersonal && <button type="button" aria-current={value === "__personal__" ? "true" : undefined}
            onClick={() => { onChange("__personal__"); if (menu.current) { menu.current.open = false; } }}>
            <strong>Meus personagens</strong><small>Sem campanha</small>
          </button>}
          {items.map(campaign => <button type="button" key={campaign.campaignId}
            aria-current={campaign.campaignId === value ? "true" : undefined}
            onClick={() => { onChange(campaign.campaignId); if (menu.current) { menu.current.open = false; } }}>
            <strong>{campaign.name}</strong><small>Código {campaign.joinCode}</small>
          </button>)}
        </div>
      </details>
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
