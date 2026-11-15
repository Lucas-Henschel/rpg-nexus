import { Link, usePath } from "../router";

const NAV = [
  { to: "/personagens", label: "Personagens" },
  { to: "/campanhas", label: "Campanhas" },
  { to: "/itens", label: "Itens" },
  { to: "/historico", label: "Histórico" },
];

export function Logo() {
  return (
    <svg className="logo__mark" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" fill="currentColor" />
      <path d="M16 8l7 12H9z" fill="var(--feltro)" />
    </svg>
  );
}

export function Header() {
  const path = usePath();
  return (
    <header className="topbar">
      <Link to="/" className="logo">
        <Logo />
        <span>RPG Nexus</span>
      </Link>
      <nav className="topbar__nav" aria-label="Seções">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="topbar__link"
            aria-current={path.startsWith(item.to) ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
