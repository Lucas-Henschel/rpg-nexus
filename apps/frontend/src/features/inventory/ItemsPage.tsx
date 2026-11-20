import { Link } from "../../app/router";

export function ItemsPage() {
  return <main className="page page--narrow">
    <h1 className="page__title">Lojas de itens</h1>
    <p className="page__lead">Cada campanha pode ter sua própria loja. Abra uma campanha para ver os itens e comprar.</p>
    <Link to="/campanhas" className="button button--brass">Ver campanhas</Link>
  </main>;
}
