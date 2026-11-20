import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { PORTRAIT_MAX_BYTES, PORTRAIT_TYPES, portraitUrl, type Character } from "../api";
import { errorMessage } from "../../../shared/http";
import { Initials } from "../../../shared/ui/Sheet";
import { useToast } from "../../../shared/ui/toast-context";
import { useAdjustMoney, useUploadPortrait } from "../queries";
import type { Draft } from "./sheetDraft";

function PortraitPicker({ character, name, readOnly }: { character: Character; name: string; readOnly: boolean }) {
  const toast = useToast();
  const upload = useUploadPortrait(character.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const portrait = portraitUrl(character);
  const action = portrait ? "Trocar retrato" : "Enviar retrato";
  const onChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!PORTRAIT_TYPES.includes(file.type)) return toast("error", "O retrato precisa ser PNG, JPEG ou WebP.");
    if (file.size > PORTRAIT_MAX_BYTES) return toast("error", "O retrato pode ter até 2 MB.");
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

/**
 * Saldo do personagem. Ele não faz parte do rascunho: cada ajuste vai na hora para o S2, que nunca
 * deixa o saldo negativo. As compras na loja também mexem nele. Só o dono da ficha ajusta.
 */
function MoneyPanel({ character }: { character: Character }) {
  const toast = useToast();
  const adjust = useAdjustMoney(character.id);
  const [amount, setAmount] = useState("");
  const value = Number(amount);
  const valid = Number.isSafeInteger(value) && value > 0;

  const send = (sign: 1 | -1) => (event?: FormEvent) => {
    event?.preventDefault();
    if (!valid) {
      return toast("error", "Informe um valor inteiro maior que zero.");
    }

    adjust.mutate(
      { delta: sign * value, reason: sign > 0 ? "ajuste na ficha (entrada)" : "ajuste na ficha (saída)" },
      {
        onSuccess: () => setAmount(""),
        onError: (error) => toast("error", errorMessage(error, "Não foi possível ajustar o saldo.")),
      },
    );
  };

  const balance = (
    <span className="money__balance">
      <strong>{character.currency.amount}</strong> {character.currency.name}
    </span>
  );

  if (!character.access?.adjustMoney) {
    return (
      <div className="money" aria-label="Dinheiro">
        {balance}
        <span className="money__hint">Só o dono da ficha ajusta o dinheiro.</span>
      </div>
    );
  }

  return (
    <form className="money" onSubmit={send(1)} aria-label="Dinheiro">
      {balance}
      <input
        className="ink-input money__amount"
        type="number"
        min={1}
        step={1}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        placeholder="Valor"
        aria-label="Valor do ajuste"
      />
      <button type="submit" className="button button--ghost-ink" disabled={adjust.isPending}>
        Adicionar
      </button>
      <button type="button" className="button button--ghost-ink" onClick={send(-1)} disabled={adjust.isPending}>
        Gastar
      </button>
    </form>
  );
}

export function SheetIdentity({ character, draft, edit, readOnly = false }: {
  character: Character; draft: Draft; edit: (changes: Partial<Draft>) => void;
  /** Ficha de outra pessoa (o mestre vendo a de um jogador): tudo só para leitura. */
  readOnly?: boolean;
}) {
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
        <label>Moeda <input className="ink-input" value={draft.currencyName} onChange={event => edit({ currencyName: event.target.value })} maxLength={30} /></label>
      </div>
      </fieldset>
      <MoneyPanel character={character} />
      <fieldset className="sheet__fieldset" disabled={readOnly}>
      <div className="sheet__meta"><span>Campanha {character.campaignId}</span>
        <label className="switch"><input type="checkbox" checked={draft.active} onChange={event => edit({ active: event.target.checked })} />
          <span>{draft.active ? "Ativo: pode receber itens" : "Inativo: não recebe itens"}</span>
        </label>
      </div>
      </fieldset>
    </div>
  </header>;
}
