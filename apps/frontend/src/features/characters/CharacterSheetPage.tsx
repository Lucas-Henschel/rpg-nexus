import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  PORTRAIT_MAX_BYTES,
  PORTRAIT_TYPES,
  portraitUrl,
  updateCharacter,
  uploadPortrait,
  type Character,
  type CharacterPatch,
  type BlockType,
  type Hold,
  type Sheet,
  type SheetBlock,
  type StatMap,
} from "../../api/characters";
import { ApiError } from "../../api/http";
import { Backpack, HpBar, Initials, Paper } from "../../components/Sheet";
import { StatsEditor } from "../../components/StatsEditor";
import { useDice } from "../../components/dice-context";
import { useToast } from "../../components/toast-context";
import { toLabel } from "../../labels";
import { Link } from "../../router";
import {
  block as newBlock,
  BLOCK_TITLES,
  normalizeSheet,
  SINGLETON_BLOCKS,
} from "../../sheet/templates";
import { CounterBlock, DiceBlock, ListBlock, TextBlock } from "./FreeBlocks";
import { characterKeys, characterQuery, errorMessage, useCharacter, useHolds } from "./queries";

interface Draft {
  name: string;
  description: string;
  hpCurrent: number;
  hpMax: number;
  maxItems: number;
  active: boolean;
  attributes: StatMap;
  skills: StatMap;
  sheet: Sheet;
}

function toDraft(c: Character): Draft {
  return {
    name: c.name,
    description: c.description ?? "",
    hpCurrent: c.hp.current,
    hpMax: c.hp.max,
    maxItems: c.capacity.maxItems,
    active: c.active,
    attributes: { ...c.attributes },
    skills: { ...c.skills },
    sheet: structuredClone(normalizeSheet(c.sheet)),
  };
}

/** Só o que mudou vai no PATCH; chave removida vira null (merge patch). */
function diffStats(before: StatMap, after: StatMap): Record<string, number | null> | undefined {
  const out: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(after)) if (before[key] !== value) out[key] = value;
  for (const key of Object.keys(before)) if (!(key in after)) out[key] = null;
  return Object.keys(out).length ? out : undefined;
}

function buildPatch(c: Character, d: Draft): CharacterPatch {
  const patch: CharacterPatch = {};
  if (d.name.trim() !== c.name) patch.name = d.name.trim();
  if (d.description.trim() !== (c.description ?? ""))
    patch.description = d.description.trim() || null;
  if (d.hpCurrent !== c.hp.current || d.hpMax !== c.hp.max)
    patch.hp = { current: d.hpCurrent, max: d.hpMax };
  if (d.maxItems !== c.capacity.maxItems) patch.maxItems = d.maxItems;
  if (d.active !== c.active) patch.active = d.active;
  const attributes = diffStats(c.attributes, d.attributes);
  if (attributes) patch.attributes = attributes;
  const skills = diffStats(c.skills, d.skills);
  if (skills) patch.skills = skills;
  if (JSON.stringify(d.sheet) !== JSON.stringify(normalizeSheet(c.sheet))) patch.sheet = d.sheet;
  return patch;
}

const BLOCK_MENU: { type: BlockType; hint: string }[] = [
  { type: "attributes", hint: "Caixas com os valores do personagem" },
  { type: "skills", hint: "Bônus que rolam com um d20" },
  { type: "hp", hint: "Barra de vida atual e máxima" },
  { type: "backpack", hint: "Espaços e itens pedidos na campanha" },
  { type: "counter", hint: "Mana, sanidade, munição, o que acabar" },
  { type: "dice", hint: "Rolagens com nome, prontas para clicar" },
  { type: "list", hint: "Magias, equipamento, pistas" },
  { type: "text", hint: "Texto livre" },
];

const HOLD_TEXT: Record<Hold["status"], string> = {
  HELD: "Reservado, aguardando o resultado",
  COMMITTED: "Entregue",
  RELEASED: "Cancelado, espaço devolvido",
};

/** Carrega a ficha e as reservas; a edição só começa com os dois em mãos. */
export function CharacterSheetPage({ id }: { id: string }) {
  const character = useCharacter(id);
  const holds = useHolds(id);

  if (character.isError || holds.isError) {
    const retry = () => {
      if (character.isError) void character.refetch();
      if (holds.isError) void holds.refetch();
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

function SheetEditor({ character, holds }: { character: Character; holds: Hold[] }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => toDraft(character));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [stale, setStale] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [menuAt, setMenuAt] = useState<number | null>(null);
  const rollDice = useDice();

  const patch = useMemo(() => buildPatch(character, draft), [character, draft]);
  const dirty = Object.keys(patch).length > 0;

  /** Troca a ficha guardada no cache; a tela relê dela. */
  const setCharacter = (updated: Character) =>
    queryClient.setQueryData(characterKeys.detail(character.id), updated);

  const reload = async () => {
    try {
      const [fresh] = await Promise.all([
        queryClient.fetchQuery({ ...characterQuery(character.id), staleTime: 0 }),
        queryClient.refetchQueries({ queryKey: characterKeys.holds(character.id) }),
      ]);
      setDraft(toDraft(fresh));
      setStale(false);
    } catch (error) {
      toast("error", errorMessage(error, "Não foi possível recarregar a ficha."));
    }
  };

  const edit = (changes: Partial<Draft>) => setDraft({ ...draft, ...changes });
  const reserved = holds.filter((h) => h.status === "HELD").reduce((sum, h) => sum + h.quantity, 0);
  const delivered = Math.max(character.capacity.slotsUsed - reserved, 0);
  const portrait = portraitUrl(character);

  const columns = draft.sheet.columns;
  const present = new Set(columns.flat().map((b) => b.type));
  const showTools = organizing || columns.every((column) => column.length === 0);
  const setColumns = (next: SheetBlock[][]) => edit({ sheet: { ...draft.sheet, columns: next } });

  const patchBlock = (col: number, index: number, changes: Partial<SheetBlock>) =>
    setColumns(
      columns.map((column, c) =>
        c === col ? column.map((b, i) => (i === index ? { ...b, ...changes } : b)) : column,
      ),
    );
  const moveBlock = (col: number, index: number, by: number) => {
    const column = [...columns[col]];
    const [moved] = column.splice(index, 1);
    column.splice(index + by, 0, moved);
    setColumns(columns.map((c, i) => (i === col ? column : c)));
  };
  const switchColumn = (col: number, index: number) => {
    const target = (col + 1) % columns.length;
    const moved = columns[col][index];
    setColumns(
      columns.map((c, i) =>
        i === col ? c.filter((_, j) => j !== index) : i === target ? [...c, moved] : c,
      ),
    );
  };
  const removeBlock = (col: number, index: number) =>
    setColumns(columns.map((c, i) => (i === col ? c.filter((_, j) => j !== index) : c)));
  const addBlock = (col: number, type: BlockType) => {
    setColumns(columns.map((c, i) => (i === col ? [...c, newBlock(type)] : c)));
    setMenuAt(null);
  };

  const renderBlock = (item: SheetBlock, onData: (data: Record<string, unknown>) => void) => {
    switch (item.type) {
      case "hp":
        return (
          <div className="vital">
            <HpBar current={draft.hpCurrent} max={draft.hpMax} />
            <div className="vital__row">
              <button
                type="button"
                className="round-step"
                onClick={() => edit({ hpCurrent: Math.max(0, draft.hpCurrent - 1) })}
                aria-label="Tirar 1 ponto de vida"
              >
                −
              </button>
              <input
                className="ink-input ink-input--number"
                type="number"
                min={0}
                value={draft.hpCurrent}
                onChange={(e) => edit({ hpCurrent: e.target.valueAsNumber })}
                aria-label="Pontos de vida atuais"
              />
              <span>de</span>
              <input
                className="ink-input ink-input--number"
                type="number"
                min={1}
                value={draft.hpMax}
                onChange={(e) => edit({ hpMax: e.target.valueAsNumber })}
                aria-label="Pontos de vida máximos"
              />
              <button
                type="button"
                className="round-step"
                onClick={() => edit({ hpCurrent: Math.min(draft.hpMax, draft.hpCurrent + 1) })}
                aria-label="Devolver 1 ponto de vida"
              >
                +
              </button>
            </div>
          </div>
        );
      case "backpack":
        return (
          <div className="vital">
            <Backpack
              maxItems={draft.maxItems >= 0 ? draft.maxItems : 0}
              delivered={delivered}
              reserved={reserved}
            />
            <label className="vital__row">
              <span>Espaços</span>
              <input
                className="ink-input ink-input--number"
                type="number"
                min={0}
                max={1000}
                value={draft.maxItems}
                onChange={(e) => edit({ maxItems: e.target.valueAsNumber })}
              />
            </label>
            {holds.length > 0 && (
              <ul className="holds">
                {holds.map((hold) => (
                  <li key={hold.operationId} className={`hold hold--${hold.status.toLowerCase()}`}>
                    <span className="hold__item">{hold.itemId ?? "Item"}</span>
                    <span className="hold__status">{HOLD_TEXT[hold.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case "attributes":
        return (
          <StatsEditor
            variant="boxes"
            noun="atributo"
            stats={draft.attributes}
            onChange={(attributes) => edit({ attributes })}
          />
        );
      case "skills":
        return (
          <StatsEditor
            variant="rows"
            noun="perícia"
            stats={draft.skills}
            onChange={(skills) => edit({ skills })}
            onRoll={(key, value) => rollDice(toLabel(key), { count: 1, sides: 20, bonus: value })}
          />
        );
      case "counter":
        return <CounterBlock title={item.title} data={item.data} onChange={onData} />;
      case "dice":
        return <DiceBlock title={item.title} data={item.data} onChange={onData} />;
      case "list":
        return <ListBlock title={item.title} data={item.data} onChange={onData} />;
      case "text":
        return <TextBlock title={item.title} data={item.data} onChange={onData} />;
    }
  };

  const problem = !draft.name.trim()
    ? "O personagem precisa de um nome."
    : !(draft.hpMax >= 1)
      ? "Os pontos de vida máximos começam em 1."
      : !(draft.hpCurrent >= 0) || draft.hpCurrent > draft.hpMax
        ? "Os pontos de vida atuais ficam entre 0 e o máximo."
        : !(draft.maxItems >= 0)
          ? "O tamanho da mochila não pode ser negativo."
          : draft.maxItems < character.capacity.slotsUsed
            ? `A mochila já tem ${character.capacity.slotsUsed} espaço(s) em uso; não dá para deixá-la menor que isso.`
            : "";

  const save = async () => {
    if (problem || !dirty) return;
    setSaving(true);
    try {
      const updated = await updateCharacter(character.id, patch, character.version);
      setCharacter(updated);
      setDraft(toDraft(updated));
      toast("ok", "Alterações salvas.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        setStale(true);
      } else {
        toast(
          "error",
          error instanceof ApiError ? error.message : "Não foi possível salvar as alterações.",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const onPortraitChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!PORTRAIT_TYPES.includes(file.type))
      return toast("error", "O retrato precisa ser PNG, JPEG ou WebP.");
    if (file.size > PORTRAIT_MAX_BYTES) return toast("error", "O retrato pode ter até 2 MB.");
    setUploading(true);
    try {
      const updated = await uploadPortrait(character.id, file);
      setCharacter(updated); // a versão mudou; o rascunho em edição continua como está
      toast("ok", "Retrato enviado.");
    } catch (error) {
      toast(
        "error",
        error instanceof ApiError ? error.message : "Não foi possível enviar o retrato.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="page page--sheet">
      <Link to="/personagens" className="back-link">
        Voltar aos personagens
      </Link>

      <Paper>
        <header className="sheet__identity">
          <div className="portrait">
            <div className="portrait__frame">
              {portrait ? (
                <img src={portrait} alt={`Retrato de ${character.name}`} />
              ) : (
                <Initials name={draft.name} />
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept={PORTRAIT_TYPES.join(",")}
              hidden
              onChange={onPortraitChosen}
            />
            <button
              type="button"
              className="text-button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Enviando…" : portrait ? "Trocar retrato" : "Enviar retrato"}
            </button>
          </div>
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
                <span>
                  {draft.active ? "Ativo: pode receber itens" : "Inativo: não recebe itens"}
                </span>
              </label>
            </div>
          </div>
        </header>

        <div className="sheet__toolbar">
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setOrganizing(!showTools);
              setMenuAt(null);
            }}
          >
            {showTools ? "Concluir organização" : "Organizar ficha"}
          </button>
        </div>

        <div className="sheet__columns">
          {columns.map((column, col) => (
            <div key={col} className="sheet__column">
              {column.map((item, index) => {
                const free = !SINGLETON_BLOCKS.includes(item.type);
                return (
                  <section key={item.id} className="block">
                    <header className="block__head">
                      {free ? (
                        <input
                          className="block__title block__title--input"
                          value={item.title}
                          onChange={(e) => patchBlock(col, index, { title: e.target.value })}
                          placeholder={BLOCK_TITLES[item.type]}
                          aria-label="Título do bloco"
                          maxLength={80}
                        />
                      ) : (
                        <h2 className="block__title">{BLOCK_TITLES[item.type]}</h2>
                      )}
                      {showTools && (
                        <span className="block__tools">
                          <button
                            type="button"
                            onClick={() => moveBlock(col, index, -1)}
                            disabled={index === 0}
                            aria-label="Mover bloco para cima"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveBlock(col, index, 1)}
                            disabled={index === column.length - 1}
                            aria-label="Mover bloco para baixo"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() => switchColumn(col, index)}
                            aria-label="Mover bloco para a outra coluna"
                          >
                            ⇄
                          </button>
                          <button
                            type="button"
                            onClick={() => removeBlock(col, index)}
                            aria-label="Remover bloco"
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </header>
                    {renderBlock(item, (data) => patchBlock(col, index, { data }))}
                  </section>
                );
              })}

              {column.length === 0 && !showTools && <p className="stats__empty">Coluna vazia.</p>}

              {showTools && (
                <div className="add-block">
                  <button
                    type="button"
                    className="add-block__button"
                    onClick={() => setMenuAt(menuAt === col ? null : col)}
                    aria-expanded={menuAt === col}
                  >
                    Adicionar bloco
                  </button>
                  {menuAt === col && (
                    <ul className="add-block__menu">
                      {BLOCK_MENU.map(({ type, hint }) => {
                        const taken = SINGLETON_BLOCKS.includes(type) && present.has(type);
                        return (
                          <li key={type}>
                            <button
                              type="button"
                              disabled={taken}
                              onClick={() => addBlock(col, type)}
                            >
                              <strong>{BLOCK_TITLES[type]}</strong>
                              <span>{taken ? "Já está na ficha" : hint}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Paper>

      {(dirty || stale) && (
        <div className="save-bar" role="region" aria-label="Alterações não salvas">
          {stale ? (
            <>
              <p>
                A ficha foi alterada em outro lugar depois que você abriu. Recarregue para ver a
                versão atual.
              </p>
              <button type="button" className="button button--brass" onClick={() => void reload()}>
                Recarregar ficha
              </button>
            </>
          ) : (
            <>
              <p>{problem || "Há alterações que ainda não foram salvas."}</p>
              <button
                type="button"
                className="button button--ghost-felt"
                onClick={() => setDraft(toDraft(character))}
                disabled={saving}
              >
                Descartar
              </button>
              <button
                type="button"
                className="button button--brass"
                onClick={() => void save()}
                disabled={saving || Boolean(problem)}
              >
                {saving ? "Salvando…" : "Salvar alterações"}
              </button>
            </>
          )}
        </div>
      )}
    </main>
  );
}
