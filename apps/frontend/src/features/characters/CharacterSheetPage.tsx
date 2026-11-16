import { useMemo, useState } from "react";
import type { Character, Hold } from "./api";
import { errorMessage, isConflict } from "../../shared/http";
import { Paper } from "../../shared/ui/Sheet";
import { useToast } from "../../shared/ui/toast-context";
import { Link } from "../../app/router";
import { useCharacter, useHolds, useReloadCharacter, useSaveCharacter } from "./queries";
import { SaveBar } from "./sheet/SaveBar";
import { buildPatch, toDraft, validate, type Draft } from "./sheet/sheetDraft";
import { SheetColumns } from "./sheet/SheetColumns";
import { SheetIdentity } from "./sheet/SheetIdentity";

/** Carrega a ficha e as reservas; a edição só começa com os dois em mãos. */
export function CharacterSheetPage({ id }: { id: string }) {
  const character = useCharacter(id);
  const holds = useHolds(id);

  if (character.isError || holds.isError) {
    const retry = () => {
      if (character.isError) {
        void character.refetch();
      }

      if (holds.isError) {
        void holds.refetch();
      }
    };

    return (
      <main className="page page--narrow">
        <div className="notice">
          <p>{errorMessage(character.error ?? holds.error, "Não foi possível abrir a ficha.")}</p>
          <button type="button" className="button button--ghost-felt" onClick={retry}>
            Tentar de novo
          </button>
          <Link to="/personagens" className="button button--ghost-felt">
            Voltar aos personagens
          </Link>
        </div>
      </main>
    );
  }

  if (!character.isSuccess || !holds.isSuccess) {
    return (
      <main className="page page--narrow">
        <p className="page__status">Abrindo a ficha…</p>
      </main>
    );
  }

  return <SheetEditor character={character.data} holds={holds.data} />;
}

/**
 * Guarda o rascunho e decide quando ele pode ser salvo. A ficha que chega por props é a última
 * versão conhecida do servidor; o rascunho é o que a pessoa está editando em cima dela.
 */
function SheetEditor({ character, holds }: { character: Character; holds: Hold[] }) {
  const toast = useToast();
  const save = useSaveCharacter(character.id);
  const reloadCharacter = useReloadCharacter(character.id);
  const [draft, setDraft] = useState(() => toDraft(character));
  const [stale, setStale] = useState(false);
  const [editing, setEditing] = useState(false);

  const patch = useMemo(() => buildPatch(character, draft), [character, draft]);
  const dirty = Object.keys(patch).length > 0;
  const problem = validate(draft, character.capacity.slotsUsed);
  const edit = (changes: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...changes }));

  const onSave = () => {
    if (problem || !dirty) {
      return;
    }

    save.mutate(
      { patch, version: character.version },
      {
        onSuccess: (updated) => {
          setDraft(toDraft(updated));
          setEditing(false);
          toast("ok", "Alterações salvas.");
        },
        onError: (error) => {
          if (isConflict(error)) {
            setStale(true);
          } else {
            toast("error", errorMessage(error, "Não foi possível salvar as alterações."));
          }
        },
      },
    );
  };

  const onReload = async () => {
    try {
      setDraft(toDraft(await reloadCharacter()));
      setStale(false);
    } catch (error) {
      toast("error", errorMessage(error, "Não foi possível recarregar a ficha."));
    }
  };

  return (
    <main className="page page--sheet">
      <Link to="/personagens" className="back-link">
        Voltar aos personagens
      </Link>

      <Paper>
        <div className="sheet__edit-action"><button type="button" className="button button--ghost-ink" onClick={() => setEditing(!editing)}>{editing ? "Concluir layout" : "Editar ficha"}</button></div>
        <SheetIdentity character={character} draft={draft} edit={edit} />
        <SheetColumns draft={draft} edit={edit} character={character} holds={holds} editing={editing} />
      </Paper>

      {(dirty || stale) && (
        <SaveBar
          stale={stale}
          problem={problem}
          saving={save.isPending}
          onSave={onSave}
          onDiscard={() => setDraft(toDraft(character))}
          onReload={() => void onReload()}
        />
      )}
    </main>
  );
}
