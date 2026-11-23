import { useRef, type ChangeEvent } from "react";
import { PORTRAIT_MAX_BYTES, PORTRAIT_TYPES, portraitUrl, type Character } from "../api";
import { errorMessage } from "../../../shared/http";
import { Initials } from "../../../shared/ui/Sheet";
import { useToast } from "../../../shared/ui/toast-context";
import { useUploadPortrait } from "../queries";
import type { Draft } from "./sheetDraft";
import { useCampaigns } from "../../campaigns/queries";
import { useAuth } from "../../auth/auth-context";
import { PERSONAL_CAMPAIGN } from "../api";

function PortraitPicker({ character, name, readOnly }: { character: Character; name: string; readOnly: boolean }) {
  const toast = useToast();
  const upload = useUploadPortrait(character.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const portrait = portraitUrl(character);
  const action = portrait ? "Trocar retrato" : "Enviar retrato";
  const onChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {return;}

    if (!PORTRAIT_TYPES.includes(file.type)) {return toast("error", "O retrato precisa ser PNG, JPEG ou WebP.");}

    if (file.size > PORTRAIT_MAX_BYTES) {return toast("error", "O retrato pode ter até 2 MB.");}

    upload.mutate(file, {
      onSuccess: () => toast("ok", "Retrato enviado."),
      onError: error => toast("error", errorMessage(error, "Não foi possível enviar o retrato.")),
    });
  };

  return <div className="portrait">
    <div className="portrait__frame">
      {portrait ? <img src={portrait} alt={`Retrato de ${character.name}`} /> : <Initials name={name} />}
      {!readOnly && <button type="button" className="portrait__edit" onClick={() => fileInput.current?.click()}
        disabled={upload.isPending} aria-label={action} title={action}>✎</button>}
    </div>
    <input ref={fileInput} type="file" accept={PORTRAIT_TYPES.join(",")} hidden onChange={onChosen} />
  </div>;
}

/** Saldo do personagem, só para leitura. Quem mexe nele são as compras na loja. */
function MoneyPanel({ character }: { character: Character }) {
  return (
    <div className="money" aria-label="Dinheiro">
      <span className="money__balance">
        Saldo: <strong>{character.currency.amount}</strong> {character.currency.name}
      </span>
      <small className="money__hint">Muda só pelas compras na loja; o saldo inicial vem do modelo de ficha.</small>
    </div>
  );
}

export function SheetIdentity({ character, draft, edit, readOnly = false }: {
  character: Character; draft: Draft; edit: (changes: Partial<Draft>) => void;
  /** Ficha de outra pessoa (o mestre vendo a de um jogador): tudo só para leitura. */
  readOnly?: boolean;
}) {
  const { user } = useAuth();
  const campaigns = useCampaigns(user?.userId ?? "");
  const campaignName = character.campaignId === PERSONAL_CAMPAIGN ? "Nenhuma campanha" :
    campaigns.data?.find(item => item.campaignId === character.campaignId)?.name ?? "Campanha";
  const header = draft.sheet.header ?? {};
  const setHeader = (key: string, value: string) => edit({ sheet: { ...draft.sheet, header: { ...header, [key]: value } } });
  const value = (key: string) => typeof header[key] === "string" || typeof header[key] === "number" ? String(header[key]) : "";

  return <header className="sheet__identity">
    <PortraitPicker character={character} name={draft.name} readOnly={readOnly} />
    <div className="sheet__who">
      <fieldset className="sheet__fieldset" disabled={readOnly}>
      <input className="ink-input ink-input--name" value={draft.name} onChange={event => edit({ name: event.target.value })}
        aria-label="Nome do personagem" maxLength={80} />
      <textarea className="ink-input" rows={2} value={draft.description} onChange={event => edit({ description: event.target.value })}
        placeholder="História em poucas linhas" aria-label="História do personagem" maxLength={2000} />
      <div className="sheet__header-fields">
        <label>Nível <input className="ink-input" type="number" min={0} value={value("level")} onChange={event => setHeader("level", event.target.value)} /></label>
        <label>Descrição do nível <input className="ink-input" value={value("levelDescription")} onChange={event => setHeader("levelDescription", event.target.value)} placeholder="Ex.: Explorador" /></label>
        <label>Defesa <input className="ink-input" type="number" min={0} value={value("defense")} onChange={event => setHeader("defense", event.target.value)} /></label>
        <label>Nome da moeda <input className="ink-input" placeholder="Ex.: Ouro" value={draft.currencyName} onChange={event => edit({ currencyName: event.target.value })} maxLength={30} /></label>
      </div>
      </fieldset>
      <MoneyPanel character={character} />
      <fieldset className="sheet__fieldset" disabled={readOnly}>
      <div className="sheet__meta"><span>{campaignName}</span>
        <label className="switch"><input type="checkbox" checked={draft.active} onChange={event => edit({ active: event.target.checked })} />
          <span>{draft.active ? "Ativo: pode receber itens" : "Inativo: não recebe itens"}</span>
        </label>
      </div>
      </fieldset>
    </div>
  </header>;
}
