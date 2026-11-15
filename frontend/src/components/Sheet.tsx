/** Peças visuais da ficha, usadas na ficha real e no exemplo da página inicial. */
import type { ReactNode } from "react";

export function Paper({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`paper ${className}`}>{children}</section>;
}

export function HpBar({ current, max }: { current: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  return (
    <div className="hp-bar" role="img" aria-label={`${current} de ${max} pontos de vida`}>
      <div className="hp-bar__fill" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

interface BackpackProps {
  maxItems: number;
  delivered: number;
  reserved: number;
}

/** Um quadrado por espaço da mochila: cheio = item entregue, hachurado = reservado numa aquisição em andamento. */
export function Backpack({ maxItems, delivered, reserved }: BackpackProps) {
  const free = Math.max(maxItems - delivered - reserved, 0);
  const summary = `${delivered} com item, ${reserved} reservado${reserved === 1 ? "" : "s"}, ${free} livre${free === 1 ? "" : "s"}`;
  if (maxItems > 40) return <p className="backpack__summary">{summary}.</p>;
  return (
    <div>
      <ul className="backpack" aria-label={`Mochila: ${summary}`}>
        {Array.from({ length: maxItems }, (_, i) => {
          const state = i < delivered ? "full" : i < delivered + reserved ? "held" : "free";
          return <li key={i} className={`backpack__slot backpack__slot--${state}`} />;
        })}
      </ul>
      <p className="backpack__summary">{summary}.</p>
    </div>
  );
}

export function Initials({ name }: { name: string }) {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
  return <span className="initials">{letters || "?"}</span>;
}
