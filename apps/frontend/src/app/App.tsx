import { QueryClientProvider } from "@tanstack/react-query";
import { DiceProvider } from "../features/dice/DiceTray";
import { Header } from "./Header";
import { ToastProvider } from "../shared/ui/Toast";
import { CharacterListPage } from "../features/characters/CharacterListPage";
import { CharacterSheetPage } from "../features/characters/CharacterSheetPage";
import { NewCharacterPage } from "../features/characters/NewCharacterPage";
import { HomePage } from "../features/home/HomePage";
import { CampaignsPage, HistoryPage, ItemsPage } from "../features/placeholders/pages";
import { matchPath, usePath } from "./navigation";
import { queryClient } from "./queryClient";
import { Link, Router } from "./router";

function Routes() {
  const path = usePath();
  if (path === "/") {
    return <HomePage />;
  }
  if (path === "/personagens") {
    return <CharacterListPage />;
  }
  if (path === "/personagens/novo") {
    return <NewCharacterPage />;
  }
  const sheet = matchPath("/personagens/:id", path);
  if (sheet) {
    return <CharacterSheetPage key={sheet.id} id={sheet.id} />;
  }
  if (path === "/campanhas") {
    return <CampaignsPage />;
  }
  if (path === "/itens") {
    return <ItemsPage />;
  }
  if (path === "/historico") {
    return <HistoryPage />;
  }
  return (
    <main className="page page--narrow">
      <h1 className="page__title">Essa página não existe</h1>
      <p className="page__lead">O endereço {path} não leva a lugar nenhum.</p>
      <Link to="/" className="button button--brass">
        Voltar ao início
      </Link>
    </main>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <ToastProvider>
          <DiceProvider>
            <Header />
            <Routes />
          </DiceProvider>
        </ToastProvider>
      </Router>
    </QueryClientProvider>
  );
}
