import { useEffect, useState, type FormEvent } from "react";
import { ApiError, errorMessage } from "../../shared/http";
import { useToast } from "../../shared/ui/toast-context";
import type { Member } from "../campaigns/api";
import { useAcquisition, useInventoryActions, useShop } from "./queries";
import type { ShopItem } from "./api";

const PURCHASE_STATUS: Record<string, string> = {
  WAITING_MONEY: "Aguardando pagamento", COMPLETED: "Item entregue",
  COMPENSATED: "Compra cancelada", REJECTED: "Compra recusada", EXPIRED: "Prazo encerrado",
};

export function CampaignShop({ campaignId, member }: { campaignId: string; member: Member }) {
  const { shop, items } = useShop(campaignId);
  const actions = useInventoryActions();
  const toast = useToast();
  const owner = member.role === "OWNER";
  const [name, setName] = useState("Loja da campanha");
  const [draft, setDraft] = useState({ itemId: "", name: "", description: "", price: "0", available: "1" });
  const [operationId, setOperationId] = useState("");
  const [problem, setProblem] = useState("");
  const acquisition = useAcquisition(operationId);

  useEffect(() => { if (shop.data) setName(shop.data.name); }, [shop.data?.name]);

  async function configure(active: boolean) {
    setProblem("");
    try {
      await actions.saveShop.mutateAsync({ campaignId, name: name.trim(), active });
      toast("ok", active ? "Loja ativada." : "Loja desativada.");
    } catch (error) { setProblem(errorMessage(error, "Não foi possível salvar a loja.")); }
  }

  async function saveItem(event: FormEvent) {
    event.preventDefault();
    const price = Number(draft.price), available = Number(draft.available);
    if (!Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(available) || available < 0) {
      setProblem("Preço e estoque devem ser números inteiros não negativos."); return;
    }
    setProblem("");
    try {
      await actions.saveShopItem.mutateAsync({ campaignId, item: {
        name: draft.name.trim(), description: draft.description.trim(), price, available,
      }, itemId: draft.itemId || undefined });
      setDraft({ itemId: "", name: "", description: "", price: "0", available: "1" });
      toast("ok", "Item salvo na loja.");
    } catch (error) { setProblem(errorMessage(error, "Não foi possível salvar o item.")); }
  }

  function edit(item: ShopItem) {
    setDraft({ itemId: item.itemId, name: item.name, description: item.description,
      price: String(item.price), available: String(item.available) });
  }

  async function remove(item: ShopItem) {
    if (!window.confirm(`Remover ${item.name} da loja?`)) return;
    setProblem("");
    try {
      await actions.removeShopItem.mutateAsync({ campaignId, itemId: item.itemId });
      toast("ok", "Item removido.");
    } catch (error) { setProblem(errorMessage(error, "Não foi possível remover o item.")); }
  }

  async function buy(item: ShopItem) {
    if (!member.characterId) return;
    setProblem(""); setOperationId("");
    try {
      const result = await actions.acquire.mutateAsync({ campaignId, characterId: member.characterId, itemId: item.itemId });
      setOperationId(result.operationId);
      toast("ok", "Compra recebida. Acompanhando o resultado.");
    } catch (error) { setProblem(errorMessage(error, "Não foi possível comprar o item.")); }
  }

  return <section className="paper inventory-panel" aria-labelledby="campaign-shop-title">
    <h2 id="campaign-shop-title" className="sheet__heading">Loja de itens</h2>
    {shop.isPending && <p>Carregando loja…</p>}
    {shop.isError && !(shop.error instanceof ApiError && shop.error.status === 404) &&
      <p className="field-error">{errorMessage(shop.error, "Não foi possível carregar a loja.")}</p>}
    {!shop.data && !shop.isPending && <p>Esta campanha ainda não tem loja.</p>}
    {owner && <div className="inventory-inline">
      <label className="inventory-field">Nome da loja
        <input value={name} onChange={event => setName(event.target.value)} maxLength={100} />
      </label>
      <button type="button" className="button button--ink button--small"
        disabled={!name.trim() || actions.saveShop.isPending}
        onClick={() => void configure(!shop.data?.active)}>
        {shop.data?.active ? "Desativar loja" : "Ativar loja"}
      </button>
      {shop.data && <button type="button" className="button button--ghost-ink button--small"
        disabled={!name.trim() || actions.saveShop.isPending} onClick={() => void configure(shop.data.active)}>Salvar nome</button>}
    </div>}
    {shop.data && <>
      <p>{shop.data.active ? shop.data.name : "Loja desativada pelo mestre."}</p>
      {items.isPending && <p>Carregando itens…</p>}
      {items.isError && <p className="field-error">{errorMessage(items.error, "Não foi possível carregar os itens.")}</p>}
      {items.data?.length === 0 && <p>Nenhum item cadastrado.</p>}
      <ul className="campaign-list">
        {items.data?.map(item => <li className="campaign-list__row" key={item.itemId}>
          <span className="campaign-list__main"><strong>{item.name}</strong> · {item.price} moedas
            <br /><small>{item.description ? `${item.description} · ` : ""}{item.available} disponíveis</small></span>
          <span className="campaign-list__side">
            {owner && <><button type="button" className="text-button" onClick={() => edit(item)}>Editar</button>{" · "}
              <button type="button" className="text-button" onClick={() => void remove(item)}
                disabled={actions.removeShopItem.isPending}>Remover</button></>}
            {!owner && shop.data.active && <button type="button" className="button button--ink button--small"
              onClick={() => void buy(item)} disabled={!member.characterId || item.available < 1 || actions.acquire.isPending}>Comprar</button>}
          </span>
        </li>)}
      </ul>
      {!owner && shop.data.active && !member.characterId && <p>Escolha seu personagem acima para comprar.</p>}
      {owner && <form className="inventory-form" onSubmit={event => void saveItem(event)}>
        <h3 className="inventory-panel__sub">{draft.itemId ? "Editar item" : "Adicionar item"}</h3>
        <label className="inventory-field">Nome <input required value={draft.name}
          onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
        <label className="inventory-field">Descrição <input value={draft.description}
          onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
        <label className="inventory-field">Preço em moedas <input type="number" min="0" step="1" required value={draft.price}
          onChange={event => setDraft({ ...draft, price: event.target.value })} /></label>
        <label className="inventory-field">Quantidade disponível <input type="number" min="0" step="1" required value={draft.available}
          onChange={event => setDraft({ ...draft, available: event.target.value })} /></label>
        <button className="button button--ink button--small" disabled={actions.saveShopItem.isPending || !draft.name.trim()}>
          {draft.itemId ? "Salvar alterações" : "Adicionar item"}
        </button>
        {draft.itemId && <button type="button" className="button button--ghost-ink button--small"
          onClick={() => setDraft({ itemId: "", name: "", description: "", price: "0", available: "1" })}>Cancelar edição</button>}
      </form>}
    </>}
    {problem && <p className="field-error" role="alert">{problem}</p>}
    {operationId && <p aria-live="polite">Compra {operationId}: {PURCHASE_STATUS[acquisition.data?.status ?? ""] ?? "processando"}</p>}
  </section>;
}
