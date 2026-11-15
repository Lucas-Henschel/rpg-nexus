/** Barra fixa no rodapé: salvar ou descartar o rascunho, ou recarregar quando a ficha mudou fora. */

interface Props {
  /** A ficha foi alterada em outro lugar (412) e o rascunho não pode mais ser salvo por cima. */
  stale: boolean;
  /** O que impede salvar, ou "". */
  problem: string;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onReload: () => void;
}

export function SaveBar({ stale, problem, saving, onSave, onDiscard, onReload }: Props) {
  if (stale) {
    return (
      <div className="save-bar" role="region" aria-label="Alterações não salvas">
        <p>
          A ficha foi alterada em outro lugar depois que você abriu. Recarregue para ver a versão
          atual.
        </p>
        <button type="button" className="button button--brass" onClick={onReload}>
          Recarregar ficha
        </button>
      </div>
    );
  }
  return (
    <div className="save-bar" role="region" aria-label="Alterações não salvas">
      <p>{problem || "Há alterações que ainda não foram salvas."}</p>
      <button
        type="button"
        className="button button--ghost-felt"
        onClick={onDiscard}
        disabled={saving}
      >
        Descartar
      </button>
      <button
        type="button"
        className="button button--brass"
        onClick={onSave}
        disabled={saving || Boolean(problem)}
      >
        {saving ? "Salvando…" : "Salvar alterações"}
      </button>
    </div>
  );
}
