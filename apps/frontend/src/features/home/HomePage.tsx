import { useState } from "react";
import { useAllServicesHealth, type Health } from "../../shared/health";
import { Backpack, HpBar, Paper } from "../../shared/ui/Sheet";
import { services, type ServiceKey } from "../../shared/config";
import { signed, toLabel } from "../../shared/labels";
import { Link } from "../../app/router";

const SAMPLE_ATTRIBUTES: Record<string, number> = {
  forca: 9,
  destreza: 17,
  constituicao: 12,
  inteligencia: 13,
  sabedoria: 11,
  carisma: 15,
};
const SAMPLE_SKILLS: Record<string, number> = { furtividade: 5, enganacao: 4, percepcao: 2 };

/** Ficha de exemplo do topo da página. Os números mudam só aqui, nada é salvo. */
function SampleSheet() {
  const [attributes, setAttributes] = useState(SAMPLE_ATTRIBUTES);
  const [hp, setHp] = useState(14);
  const bump = (key: string, by: number) =>
    setAttributes((prev) => ({ ...prev, [key]: prev[key] + by }));

  return (
    <Paper className="paper--sample">
      <header className="sample__head">
        <div className="sample__portrait" aria-hidden="true">
          <svg viewBox="0 0 80 96">
            <path d="M40 8c13 0 21 10 21 23 0 9-4 16-9 20 12 4 20 13 22 27v18H6V78c2-14 10-23 22-27-5-4-9-11-9-20C19 18 27 8 40 8z" />
          </svg>
        </div>
        <div>
          <h2 className="sample__name">Lyra Ventobravo</h2>
          <p className="sample__meta">Ladina da campanha A Coroa de Cinzas</p>
        </div>
      </header>

      <div className="sample__hp">
        <span className="sheet-label">Pontos de vida</span>
        <HpBar current={hp} max={22} />
        <span className="sample__hp-controls">
          <button
            type="button"
            onClick={() => setHp((v) => Math.max(0, v - 1))}
            aria-label="Tirar 1 ponto de vida"
          >
            −
          </button>
          <strong>{hp} / 22</strong>
          <button
            type="button"
            onClick={() => setHp((v) => Math.min(22, v + 1))}
            aria-label="Devolver 1 ponto de vida"
          >
            +
          </button>
        </span>
      </div>

      <ul className="stat-grid stat-grid--compact">
        {Object.entries(attributes).map(([key, value]) => (
          <li key={key} className="stat-box">
            <span className="stat-box__name">{toLabel(key)}</span>
            <span className="stat-box__value">{value}</span>
            <span className="stat-box__steps">
              <button
                type="button"
                onClick={() => bump(key, -1)}
                aria-label={`Diminuir ${toLabel(key)}`}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => bump(key, 1)}
                aria-label={`Aumentar ${toLabel(key)}`}
              >
                +
              </button>
            </span>
          </li>
        ))}
      </ul>

      <ul className="stat-rows">
        {Object.entries(SAMPLE_SKILLS).map(([key, value]) => (
          <li key={key} className="stat-row">
            <span className="stat-row__name">{toLabel(key)}</span>
            <span className="stat-row__dots" aria-hidden="true" />
            <output className="stat-row__value">{signed(value)}</output>
          </li>
        ))}
      </ul>

      <span className="sheet-label">Mochila</span>
      <Backpack maxItems={10} delivered={3} reserved={1} />
      <p className="sample__note">Ficha de exemplo. Pode mexer nos números.</p>
    </Paper>
  );
}

const JOURNEY: { title: string; text: string; to: string; action: string; service: ServiceKey }[] =
  [
    {
      title: "Monte a ficha",
      text: "Dê nome ao personagem, escolha os atributos e as perícias que a sua mesa usa e envie um retrato.",
      to: "/personagens/novo",
      action: "Criar personagem",
      service: "characters",
    },
    {
      title: "Reúna a campanha",
      text: "Quem mestra abre a campanha e chama os personagens que vão jogar nela.",
      to: "/campanhas",
      action: "Ver campanhas",
      service: "campaigns",
    },
    {
      title: "Dispute o item raro",
      text: "Dez unidades no estoque, cem pedidos no mesmo segundo. Dez personagens levam, e ninguém leva em dobro.",
      to: "/itens",
      action: "Ver itens",
      service: "inventory",
    },
    {
      title: "Releia a história",
      text: "Cada item entregue e cada pedido cancelado fica registrado na linha do tempo da campanha.",
      to: "/historico",
      action: "Ver histórico",
      service: "actions",
    },
  ];

const HEALTH_TEXT: Record<Health, string> = {
  checking: "verificando",
  up: "no ar",
  down: "fora do ar",
};

export function HomePage() {
  const health = useAllServicesHealth();
  return (
    <main>
      <section className="hero">
        <div className="hero__copy">
          <h1 className="hero__title">A mesa inteira quer a mesma espada.</h1>
          <p className="hero__lead">
            O RPG Nexus guarda a ficha de cada personagem, organiza a campanha e decide quem fica
            com o último item do estoque quando todo mundo pede ao mesmo tempo.
          </p>
          <div className="hero__actions">
            <Link to="/personagens/novo" className="button button--brass">
              Criar personagem
            </Link>
            <a href="#jornada" className="button button--ghost-felt">
              Ver a jornada da campanha
            </a>
          </div>
        </div>
        <div className="hero__sheet">
          <SampleSheet />
        </div>
      </section>

      <section className="journey" id="jornada">
        <h2 className="section-title">Da ficha em branco ao item na mochila</h2>
        <ol className="journey__steps">
          {JOURNEY.map((step, index) => (
            <li key={step.title} className="journey__step">
              <span className="journey__marker">{index + 1}</span>
              <h3 className="journey__title">{step.title}</h3>
              <p className="journey__text">{step.text}</p>
              <Link to={step.to} className="journey__link">
                {step.action}
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="under">
        <div className="under__copy">
          <h2 className="section-title">Por baixo da mesa</h2>
          <p>
            Quatro serviços independentes, cada um com o próprio banco de dados, conversam por
            mensagens. Se um deles cai no meio de uma aquisição, o item volta para o estoque e a
            vaga volta para a mochila.
          </p>
          <p className="under__tech">
            Mensagens pelo RabbitMQ, dados no DynamoDB e retratos no S3.
          </p>
        </div>
        <ul className="under__services">
          {(Object.keys(services) as ServiceKey[]).map((key) => (
            <li key={key} className="service">
              <span className={`service__dot service__dot--${health[key]}`} aria-hidden="true" />
              <span className="service__name">{services[key].name}</span>
              <span className="service__stack">{services[key].stack}</span>
              <span className="service__state">{HEALTH_TEXT[health[key]]}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="footer">
        <p>RPG Nexus, trabalho final de Sistemas Distribuídos da FURB.</p>
      </footer>
    </main>
  );
}
