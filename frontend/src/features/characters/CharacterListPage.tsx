import { useEffect, useState, type FormEvent } from "react";
import { listCharacters, portraitUrl, type Character } from "../../api/characters";
import { ApiError } from "../../api/http";
import { CAMPAIGN_PATTERN, useCampaign } from "../../components/campaign";
import { HpBar, Initials } from "../../components/Sheet";
import { toLabel } from "../../labels";
import { Link } from "../../router";

type State = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; characters: Character[] };

function CharacterTile({ character }: { character: Character }) {
  const portrait = portraitUrl(character);
  const top = Object.entries(character.attributes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return (
    <Link to={`/personagens/${character.id}`} className={`tile${character.active ? "" : " tile--inactive"}`}>
      <span className="tile__portrait">{portrait ? <img src={portrait} alt="" /> : <Initials name={character.name} />}</span>
      <span className="tile__body">
        <span className="tile__name">{character.name}</span>
        {!character.active && <span className="tile__flag">Inativo</span>}
        <HpBar current={character.hp.current} max={character.hp.max} />
        <span className="tile__hp">
          {character.hp.current} de {character.hp.max} pontos de vida
        </span>
        {top.length > 0 && (
          <span className="tile__stats">
            {top.map(([key, value]) => (
              <span key={key}>
                {toLabel(key)} <strong>{value}</strong>
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}

export function CharacterListPage() {
  const [campaign, setCampaign] = useCampaign();
  const [draft, setDraft] = useState(campaign);
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    listCharacters(campaign)
      .then((characters) => alive && setState({ status: "ready", characters }))
      .catch((error: unknown) => {
        const message = error instanceof ApiError ? error.message : "Não foi possível carregar os personagens.";
        if (alive) setState({ status: "error", message });
      });
    return () => {
      alive = false;
    };
  }, [campaign, attempt]);

  const changeCampaign = (event: FormEvent) => {
    event.preventDefault();
    if (CAMPAIGN_PATTERN.test(draft.trim())) setCampaign(draft.trim());
  };
  const draftValid = CAMPAIGN_PATTERN.test(draft.trim());

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Personagens</h1>
          <form className="campaign-picker" onSubmit={changeCampaign}>
            <label htmlFor="campaign">Campanha</label>
            <input id="campaign" className="felt-input" value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} />
            {draft.trim() !== campaign && (
              <button type="submit" className="button button--ghost-felt button--small" disabled={!draftValid}>
                Trocar campanha
              </button>
            )}
          </form>
          {!draftValid && <p className="field-error field-error--felt">Use só letras, números, hífen e sublinhado.</p>}
        </div>
        <Link to="/personagens/novo" className="button button--brass">
          Criar personagem
        </Link>
      </header>

      {state.status === "loading" && <p className="page__status">Buscando as fichas da campanha {campaign}…</p>}

      {state.status === "error" && (
        <div className="notice">
          <p>{state.message}</p>
          <button type="button" className="button button--ghost-felt" onClick={() => setAttempt((n) => n + 1)}>
            Tentar de novo
          </button>
        </div>
      )}

      {state.status === "ready" && state.characters.length === 0 && (
        <div className="notice">
          <p>A campanha {campaign} ainda não tem personagens.</p>
          <Link to="/personagens/novo" className="button button--brass">
            Criar o primeiro personagem
          </Link>
        </div>
      )}

      {state.status === "ready" && state.characters.length > 0 && (
        <ul className="tiles">
          {state.characters.map((character) => (
            <li key={character.id}>
              <CharacterTile character={character} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
