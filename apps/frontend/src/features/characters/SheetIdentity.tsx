/** Topo da ficha: retrato, nome, história e se o personagem está ativo. */
import { useRef, type ChangeEvent } from "react";
import {
  PORTRAIT_MAX_BYTES,
  PORTRAIT_TYPES,
  portraitUrl,
  type Character,
} from "../../api/characters";
import { errorMessage } from "../../api/http";
import { Initials } from "../../components/Sheet";
import { useToast } from "../../components/toast-context";
import { useUploadPortrait } from "./queries";
import type { Draft } from "./sheetDraft";

/** O retrato é enviado na hora, separado do botão de salvar. */
function PortraitPicker({ character, name }: { character: Character; name: string }) {
  const toast = useToast();
  const upload = useUploadPortrait(character.id);
  const fileInput = useRef<HTMLInputElement>(null);
  const portrait = portraitUrl(character);
  const action = portrait ? "Trocar retrato" : "Enviar retrato";

  const onChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!PORTRAIT_TYPES.includes(file.type)) {
      return toast("error", "O retrato precisa ser PNG, JPEG ou WebP.");
    }
    if (file.size > PORTRAIT_MAX_BYTES) {
      return toast("error", "O retrato pode ter até 2 MB.");
    }
    // A versão da ficha muda com o upload; o rascunho em edição continua como está.
    upload.mutate(file, {
      onSuccess: () => toast("ok", "Retrato enviado."),
      onError: (error) => toast("error", errorMessage(error, "Não foi possível enviar o retrato.")),
    });
  };

  return (
    <div className="portrait">
      <div className="portrait__frame">
        {portrait ? (
          <img src={portrait} alt={`Retrato de ${character.name}`} />
        ) : (
          <Initials name={name} />
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={PORTRAIT_TYPES.join(",")}
        hidden
        onChange={onChosen}
      />
      <button
        type="button"
        className="text-button"
        onClick={() => fileInput.current?.click()}
        disabled={upload.isPending}
      >
        {upload.isPending ? "Enviando…" : action}
      </button>
    </div>
  );
}

interface Props {
  character: Character;
  draft: Draft;
  edit: (changes: Partial<Draft>) => void;
}

export function SheetIdentity({ character, draft, edit }: Props) {
  return (
    <header className="sheet__identity">
      <PortraitPicker character={character} name={draft.name} />
      <div className="sheet__who">
        <input
          className="ink-input ink-input--name"
          value={draft.name}
          onChange={(e) => edit({ name: e.target.value })}
          aria-label="Nome do personagem"
          maxLength={80}
        />
        <textarea
          className="ink-input"
          rows={2}
          value={draft.description}
          onChange={(e) => edit({ description: e.target.value })}
          placeholder="História em poucas linhas"
          aria-label="História do personagem"
          maxLength={2000}
        />
        <div className="sheet__meta">
          <span>Campanha {character.campaignId}</span>
          <label className="switch">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => edit({ active: e.target.checked })}
            />
            <span>{draft.active ? "Ativo: pode receber itens" : "Inativo: não recebe itens"}</span>
          </label>
        </div>
      </div>
    </header>
  );
}
