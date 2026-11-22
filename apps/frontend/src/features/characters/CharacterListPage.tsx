import { portraitUrl, type Character } from "./api";
import { errorMessage } from "../../shared/http";
import { useCampaign } from "../../shared/campaign";
import { CampaignPicker } from "../campaigns/CampaignPicker";
import { cx } from "../../shared/ui/cx";
import { HpBar, Initials } from "../../shared/ui/Sheet";
import { toLabel } from "../../shared/labels";
import { Link } from "../../app/router";
import { useCharacters } from "./queries";
import { useAuth } from "../auth/auth-context";
import { useCampaigns } from "../campaigns/queries";

function CharacterTile({ character }: { character: Character }) {
  const portrait = portraitUrl(character);
  const top = Object.entries(character.attributes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <Link
      to={`/personagens/${character.id}`}
      className={cx("tile", !character.active && "tile--inactive")}
    >
      <span className="tile__portrait">
        {portrait ? <img src={portrait} alt="" /> : <Initials name={character.name} />}
      </span>
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
  const { user } = useAuth();
  const userId = user?.userId ?? "";
  const campaigns = useCampaigns(userId);
  const [storedCampaign, setCampaign] = useCampaign(user?.userId);
  const campaign = campaigns.isSuccess
    ? campaigns.data.find((item) => item.campaignId === storedCampaign)?.campaignId ?? campaigns.data[0]?.campaignId ?? ""
    : campaigns.isError ? storedCampaign : "";
  const characters = useCharacters(campaign);

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Personagens</h1>
          <CampaignPicker userId={userId} value={campaign} onChange={setCampaign} />
        </div>
        <Link to="/personagens/novo" className="button button--brass">
          Criar personagem
        </Link>
      </header>

      {!campaign && campaigns.isPending && <p className="page__status">Carregando suas campanhas…</p>}
      {campaigns.isSuccess && campaigns.data.length === 0 && (<div className="notice"><p>Você ainda não participa de nenhuma campanha.</p><Link to="/campanhas" className="button button--brass">Ver campanhas</Link></div>)}
      {characters.isPending && campaign && (
        <p className="page__status">Buscando as fichas da campanha {campaign}…</p>
      )}

      {characters.isError && campaign && (
        <div className="notice">
          <p>{errorMessage(characters.error, "Não foi possível carregar os personagens.")}</p>
          <button
            type="button"
            className="button button--ghost-felt"
            onClick={() => void characters.refetch()}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {characters.isSuccess && characters.data.length === 0 && (
        <div className="notice">
          <p>A campanha {campaign} ainda não tem personagens.</p>
          <Link to="/personagens/novo" className="button button--brass">
            Criar o primeiro personagem
          </Link>
        </div>
      )}

      {characters.isSuccess && characters.data.length > 0 && (
        <ul className="tiles">
          {characters.data.map((character) => (
            <li key={character.id}>
              <CharacterTile character={character} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
