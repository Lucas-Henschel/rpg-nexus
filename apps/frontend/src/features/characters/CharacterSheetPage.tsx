import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { assignCharacterCampaign, PERSONAL_CAMPAIGN, type Character, type Hold } from "./api";
import { errorMessage, isConflict, retryWhileMembershipPending } from "../../shared/http";
import { Paper } from "../../shared/ui/Sheet";
import { useToast } from "../../shared/ui/toast-context";
import { Link } from "../../app/router";
import { characterKeys, useCharacter, useHolds, useReloadCharacter, useSaveCharacter } from "./queries";
import { useCampaigns } from "../campaigns/queries";
import { useAuth } from "../auth/auth-context";
import { navigate } from "../../app/navigation";
import { SaveAsTemplate } from "./sheet/SaveAsTemplate";
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

  // Sem o campo (resposta antiga), vale o que valia antes: quem abriu é o dono.
  const canEdit = character.access?.edit ?? true;
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
        {canEdit ? (
          <div className="sheet__edit-action">
            <SaveAsTemplate draft={draft} />
            <button type="button" className="button button--ghost-ink" onClick={() => setEditing(!editing)}>
              {editing ? "Concluir layout" : "Editar ficha"}
            </button>
          </div>
        ) : (
          <p className="sheet__readonly">
            Ficha de um jogador da sua campanha: você vê, mas só o dono edita e ajusta o dinheiro.
          </p>
        )}
        <SheetIdentity character={character} draft={draft} edit={edit} readOnly={!canEdit} />
        <fieldset className="sheet__fieldset" disabled={!canEdit}>
          <SheetColumns draft={draft} edit={edit} character={character} holds={holds} editing={editing} />
        </fieldset>
      </Paper>

      {canEdit && character.campaignId === PERSONAL_CAMPAIGN && <AssignCampaign character={character} disabled={dirty} />}

      {canEdit && (dirty || stale) && (
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

function AssignCampaign({ character, disabled }: { character: Character; disabled: boolean }) {
  const { user } = useAuth();
  const campaigns = useCampaigns(user?.userId ?? "");
  const queryClient = useQueryClient();
  const toast = useToast();
  const [chosen, setChosen] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  async function assign() {
    if (!chosen) {return;}

    setSaving(true);
    setProblem("");
    try {
      const updated = await retryWhileMembershipPending(() => assignCharacterCampaign(character.id, chosen));
      queryClient.setQueryData(characterKeys.detail(character.id), updated);
      await queryClient.invalidateQueries({ queryKey: ["characters", "list"] });
      toast("ok", `${character.name} foi adicionado à campanha.`);
      navigate(`/campanhas/${encodeURIComponent(chosen)}`);
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível adicionar o personagem à campanha."));
    } finally {
      setSaving(false);
    }
  }

  return <section className="paper personal-assignment">
    <h2 className="sheet__heading">Adicionar a uma campanha</h2>
    {campaigns.data?.length ? <>
      <div className="choice-grid" role="group" aria-label="Escolha uma campanha">
        {campaigns.data.map(item => <button type="button" key={item.campaignId}
          className={`choice-card${chosen === item.campaignId ? " choice-card--selected" : ""}`}
          onClick={() => setChosen(item.campaignId)}>{item.name}</button>)}
      </div>
      <button type="button" className="button button--ink button--small" disabled={!chosen || disabled || saving}
        onClick={() => void assign()}>{saving ? "Adicionando…" : "Adicionar personagem"}</button>
      {disabled && <p>Salve as alterações da ficha antes de adicioná-la.</p>}
    </> : <p>Entre em uma campanha para adicionar este personagem.</p>}
    {problem && <p className="field-error">{problem}</p>}
  </section>;
}
