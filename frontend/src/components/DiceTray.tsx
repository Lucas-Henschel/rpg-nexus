/**
 * Bandeja de dados: qualquer tela chama useDice()(rótulo, fórmula) e os dados caem sobre a mesa.
 * O sorteio é feito no navegador. Quando o serviço de Ações (S4) tiver POST /rolls, troque a chamada
 * de roll() em rollDice por uma requisição a ele; o resto da bandeja não muda.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { formatFormula, parseFormula, roll, rollDie, type DiceFormula, type RollResult } from "../sheet/dice";

type RollDice = (label: string, formula: string | DiceFormula) => void;

const DiceContext = createContext<RollDice>(() => {});

export function useDice(): RollDice {
  return useContext(DiceContext);
}

const TUMBLE_MS = 950;
const STAGGER_MS = 90;
const QUICK = [4, 6, 8, 10, 12, 20, 100];

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Silhueta de cada dado, vista de cima. */
function DieShape({ sides }: { sides: number }) {
  switch (sides) {
    case 4:
      return <polygon points="50,8 95,88 5,88" />;
    case 6:
      return <rect x="12" y="12" width="76" height="76" rx="10" />;
    case 8:
      return <polygon points="50,4 93,50 50,96 7,50" />;
    case 10:
      return <polygon points="50,4 92,40 50,96 8,40" />;
    case 12:
      return <polygon points="50,5 95,38 78,92 22,92 5,38" />;
    case 20:
      return (
        <>
          <polygon points="50,4 90,27 90,73 50,96 10,73 10,27" />
          <polygon className="die__facet" points="50,22 78,70 22,70" />
        </>
      );
    default:
      return <circle cx="50" cy="50" r="44" />;
  }
}

export function DieIcon({ sides, className = "" }: { sides: number; className?: string }) {
  return (
    <svg className={`die-icon ${className}`} viewBox="0 0 100 100" aria-hidden="true">
      <DieShape sides={sides} />
    </svg>
  );
}

function Die({ sides, value, index }: { sides: number; value: number; index: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : rollDie(sides)));
  const [settled, setSettled] = useState(prefersReducedMotion);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const flicker = window.setInterval(() => setShown(rollDie(sides)), 70);
    const stop = window.setTimeout(() => {
      window.clearInterval(flicker);
      setShown(value);
      setSettled(true);
    }, TUMBLE_MS + index * STAGGER_MS);
    return () => {
      window.clearInterval(flicker);
      window.clearTimeout(stop);
    };
  }, [sides, value, index]);

  const mood = !settled ? "" : value === sides ? " die--max" : value === 1 ? " die--min" : "";
  return (
    <span className={`die${mood}`} style={{ animationDelay: `${index * STAGGER_MS}ms` }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <DieShape sides={sides} />
      </svg>
      <span className={`die__value${sides === 4 ? " die__value--low" : ""}`}>{shown}</span>
    </span>
  );
}

function breakdown(result: RollResult): string {
  const parts = result.dice.join(" + ");
  const { bonus } = result.formula;
  return bonus === 0 ? parts : `${parts} ${bonus > 0 ? "+" : "−"} ${Math.abs(bonus)}`;
}

export function DiceProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<RollResult | null>(null);
  const [settled, setSettled] = useState(false);
  const [history, setHistory] = useState<RollResult[]>([]);
  const [open, setOpen] = useState(false);
  const [formula, setFormula] = useState("2d6+3");
  const [problem, setProblem] = useState("");
  const timers = useRef<number[]>([]);

  const rollDice = useCallback<RollDice>((label, input) => {
    const parsed = typeof input === "string" ? parseFormula(input) : input;
    if (!parsed) return;
    timers.current.forEach(window.clearTimeout);
    const result = roll(label, parsed);
    const wait = prefersReducedMotion() ? 0 : TUMBLE_MS + parsed.count * STAGGER_MS;
    setCurrent(result);
    setSettled(wait === 0);
    timers.current = [
      window.setTimeout(() => {
        setSettled(true);
        setHistory((prev) => [result, ...prev].slice(0, 8));
      }, wait),
      window.setTimeout(() => setCurrent(null), wait + 9000),
    ];
  }, []);

  useEffect(() => () => timers.current.forEach(window.clearTimeout), []);

  const rollTyped = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseFormula(formula);
    if (!parsed) return setProblem("Escreva algo como d20, 2d6+3 ou 1d8-1.");
    setProblem("");
    rollDice("Rolagem livre", parsed);
  };

  return (
    <DiceContext.Provider value={rollDice}>
      {children}

      {current && (
        <div className="dice-stage" key={current.id} onClick={() => setCurrent(null)}>
          <div className="dice-stage__dice">
            {current.dice.map((value, index) => (
              <Die key={index} sides={current.formula.sides} value={value} index={index} />
            ))}
          </div>
          <div className="dice-stage__result" role="status" aria-live="polite">
            {settled && (
              <>
                <span className="dice-stage__label">
                  {current.label}, {formatFormula(current.formula)}
                </span>
                <strong className="dice-stage__total">{current.total}</strong>
                {(current.dice.length > 1 || current.formula.bonus !== 0) && (
                  <span className="dice-stage__parts">{breakdown(current)}</span>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {open && (
        <aside className="dice-panel" aria-label="Bandeja de dados">
          <h2 className="dice-panel__title">Dados</h2>
          <div className="dice-panel__quick">
            {QUICK.map((sides) => (
              <button key={sides} type="button" className="dice-panel__die" onClick={() => rollDice(`d${sides}`, { count: 1, sides, bonus: 0 })}>
                <DieIcon sides={sides} />
                <span>d{sides}</span>
              </button>
            ))}
          </div>
          <form className="dice-panel__form" onSubmit={rollTyped}>
            <input className="felt-input" value={formula} onChange={(e) => setFormula(e.target.value)} aria-label="Fórmula da rolagem" spellCheck={false} />
            <button type="submit" className="button button--brass button--small">
              Rolar
            </button>
          </form>
          {problem && <p className="field-error field-error--felt">{problem}</p>}
          {history.length > 0 && (
            <ol className="dice-panel__history">
              {history.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.label}, {formatFormula(item.formula)}
                  </span>
                  <strong>{item.total}</strong>
                </li>
              ))}
            </ol>
          )}
        </aside>
      )}

      <button type="button" className="dice-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <DieIcon sides={20} />
        <span>{open ? "Fechar dados" : "Dados"}</span>
      </button>
    </DiceContext.Provider>
  );
}
