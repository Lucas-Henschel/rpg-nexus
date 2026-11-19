import { useEffect, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCampaign, CAMPAIGN_PATTERN } from "../../shared/campaign";
import { errorMessage, ApiError } from "../../shared/http";
import { useToast } from "../../shared/ui/toast-context";
import { Link } from "../../app/router";
import { useCharacters } from "../characters/queries";
import { useAcquisition, useCatalog, useInventory, useInventoryActions, useShop, useStock } from "./queries";

const TERMINAL = new Set(["COMPLETED", "COMPENSATED", "REJECTED", "EXPIRED"]);
const STATUS: Record<string, string> = {
  WAITING_MONEY: "Aguardando dÃ©bito do personagem",
  PENDING: "Aguardando reserva", RESERVED: "Item reservado",
  VALIDATING_CHARACTER: "Validando personagem", VALIDATING_EXTERNAL: "Validando aquisição",
  COMPLETED: "Item entregue", COMPENSATING: "Devolvendo ao estoque",
  COMPENSATED: "Pedido cancelado e estoque devolvido", REJECTED: "Sem estoque disponível",
  EXPIRED: "Prazo encerrado e estoque devolvido",
};

export function ItemsPage() {
  const [campaign, setCampaign] = useCampaign();
  const [campaignDraft, setCampaignDraft] = useState(campaign);
  const [itemDraft, setItemDraft] = useState("");
  const [itemId, setItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("0");
  const [quantity, setQuantity] = useState("1");
  const [userId, setUserId] = useState(() => window.localStorage.getItem("rpg-nexus.user-id") || "user-1");
  const [shopName, setShopName] = useState("Loja da campanha");
  const [characterId, setCharacterId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [problem, setProblem] = useState("");
  const toast = useToast();
  const client = useQueryClient();
  const characters = useCharacters(campaign);
  const catalog = useCatalog(campaign);
  const shop = useShop(campaign);
  const stock = useStock(campaign, itemId);
  const inventory = useInventory(characterId);
  const acquisition = useAcquisition(operationId);
  const actions = useInventoryActions();

  useEffect(() => {
    if (!operationId || !acquisition.data || !TERMINAL.has(acquisition.data.status)) return;
    void client.invalidateQueries({ queryKey: ["inventory", "stock", campaign, itemId] });
    void client.invalidateQueries({ queryKey: ["inventory", "stocks", campaign] });
    if (characterId) void client.invalidateQueries({ queryKey: ["inventory", "character", characterId] });
  }, [operationId, acquisition.data?.status, campaign, itemId, characterId, client]);

  useEffect(() => {
    if (shop.shop.data?.name) setShopName(shop.shop.data.name);
  }, [shop.shop.data?.name]);

  const changeCampaign = (event: FormEvent) => {
    event.preventDefault();
    const next = campaignDraft.trim();
    if (!CAMPAIGN_PATTERN.test(next)) return;
    setCampaign(next);
    setCharacterId("");
    setOperationId("");
    setProblem("");
  };

  const lookUp = (event: FormEvent) => {
    event.preventDefault();
    setItemId(itemDraft.trim());
    setOperationId("");
    setProblem("");
  };

  const addItem = async (event: FormEvent) => {
    event.preventDefault();
    setProblem("");
    try {
      await actions.createItem.mutateAsync({ itemId: itemDraft.trim(), name: itemName.trim() });
      setItemId(itemDraft.trim());
      toast("ok", `${itemName.trim()} adicionado ao catálogo.`);
    } catch (error) { setProblem(errorMessage(error, "Não foi possível criar o item.")); }
  };

  const addStock = async (event: FormEvent) => {
    event.preventDefault();
    const amount = Number(quantity);
    if (!Number.isSafeInteger(amount) || amount < 0) return setProblem("Informe uma quantidade inteira não negativa.");
    setProblem("");
    try {
      await actions.createStock.mutateAsync({ campaignId: campaign, itemId, available: amount, userId });
      toast("ok", `Estoque de ${itemId} criado na campanha ${campaign}.`);
      await stock.refetch();
    } catch (error) { setProblem(errorMessage(error, "Não foi possível criar o estoque.")); }
  };

  const saveShop = async () => {
    setProblem("");
    try {
      window.localStorage.setItem("rpg-nexus.user-id", userId);
      await actions.saveShop.mutateAsync({ campaignId: campaign, name: shopName.trim(), active: true, userId });
      toast("ok", "Loja salva.");
    } catch (error) { setProblem(errorMessage(error, "NÃ£o foi possÃ­vel salvar a loja.")); }
  };

  const saveShopItem = async (event: FormEvent) => {
    event.preventDefault();
    const available = Number(quantity);
    const itemPrice = Number(price);
    if (!Number.isSafeInteger(available) || available < 0 || !Number.isSafeInteger(itemPrice) || itemPrice < 0) {
      setProblem("PreÃ§o e estoque devem ser inteiros nÃ£o negativos.");
      return;
    }
    try {
      await actions.saveShopItem.mutateAsync({ campaignId: campaign, userId, item: {
        itemId: itemDraft.trim(), name: itemName.trim(), description: description.trim(), price: itemPrice, available,
      }});
      setItemId(itemDraft.trim());
      toast("ok", "Item da loja salvo.");
    } catch (error) { setProblem(errorMessage(error, "NÃ£o foi possÃ­vel salvar o item da loja.")); }
  };

  const acquire = async () => {
    if (!characterId || !itemId) return;
    setProblem("");
    setOperationId("");
    try {
      const accepted = await actions.acquire.mutateAsync({ campaignId: campaign, characterId, itemId, userId });
      setOperationId(accepted.operationId);
      toast("ok", "Pedido recebido. Acompanhando o resultado.");
    } catch (error) { setProblem(errorMessage(error, "Não foi possível pedir o item.")); }
  };

  return (
    <main className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Itens e inventário</h1>
          <p className="page__lead">Consulte o estoque da campanha e acompanhe cada pedido até o resultado.</p>
          <form className="campaign-picker" onSubmit={changeCampaign}>
            <label htmlFor="inventory-campaign">Campanha</label>
            <input id="inventory-campaign" className="felt-input" value={campaignDraft}
              onChange={(event) => setCampaignDraft(event.target.value)} spellCheck={false} />
            {campaignDraft.trim() !== campaign && (
              <button className="button button--ghost-felt button--small" disabled={!CAMPAIGN_PATTERN.test(campaignDraft.trim())}>
                Trocar campanha
              </button>
            )}
          </form>
          <div className="inventory-inline">
            <label className="inventory-field">UsuÃ¡rio atual
              <input value={userId} onChange={(event) => setUserId(event.target.value)} />
            </label>
            <label className="inventory-field">Nome da loja
              <input value={shopName} onChange={(event) => setShopName(event.target.value)} />
            </label>
            <button type="button" className="button button--ghost-felt button--small" onClick={() => void saveShop()}
              disabled={!userId.trim() || !shopName.trim() || actions.saveShop.isPending}>Salvar loja</button>
          </div>
        </div>
      </header>

      <div className="inventory-layout">
        <section className="paper inventory-panel" aria-labelledby="inventory-stock-title">
          <h2 id="inventory-stock-title" className="inventory-panel__title">Estoque</h2>
          <p className="inventory-panel__hint">Itens disponíveis para consulta na campanha {campaign}.</p>
          {catalog.items.isPending && <p>Carregando catálogo…</p>}
          {catalog.items.isError && <p className="field-error">{errorMessage(catalog.items.error, "Não foi possível carregar o catálogo.")}</p>}
          {catalog.items.isSuccess && catalog.items.data.length === 0 && <p>Nenhum item cadastrado ainda.</p>}
          {catalog.items.isSuccess && catalog.items.data.length > 0 && (
            <ul className="inventory-catalog">
              {catalog.items.data.map((item) => {
                const available = catalog.stocks.data?.find((entry) => entry.itemId === item.itemId)?.available;
                return <li key={item.itemId}>
                  <button type="button" className={itemId === item.itemId ? "inventory-catalog__item inventory-catalog__item--active" : "inventory-catalog__item"}
                    onClick={() => { setItemDraft(item.itemId); setItemId(item.itemId); setOperationId(""); }}>
                    <strong>{item.name}</strong><small>{item.itemId}</small>
                    <span>{available === undefined ? "Sem estoque" : `${available} disponíveis`}</span>
                  </button>
                </li>;
              })}
            </ul>
          )}
          {catalog.stocks.isError && <p className="field-error">{errorMessage(catalog.stocks.error, "Não foi possível carregar os estoques.")}</p>}
          <p className="inventory-panel__hint">Também é possível buscar pelo código:</p>
          <form className="inventory-inline" onSubmit={lookUp}>
            <label className="inventory-field" htmlFor="inventory-item-id">Código do item
              <input id="inventory-item-id" value={itemDraft} onChange={(event) => setItemDraft(event.target.value)} required />
            </label>
            <button className="button button--ink" disabled={!itemDraft.trim()}>Consultar</button>
          </form>
          {itemId && (
            <div className="inventory-stock" aria-live="polite">
              <strong>{itemId}</strong>
              {stock.isPending && <span>Consultando estoque…</span>}
              {stock.isSuccess && <span>{stock.data.available} disponíveis</span>}
              {stock.isError && (
                <span>{stock.error instanceof ApiError && stock.error.status === 404
                  ? "Estoque ainda não cadastrado nesta campanha."
                  : errorMessage(stock.error, "Não foi possível consultar o estoque.")}</span>
              )}
            </div>
          )}
          <div className="inventory-divider" />
          <h3 className="inventory-panel__sub">Preparar item</h3>
          <p className="inventory-panel__hint">Cadastre o item uma vez; depois crie o estoque da campanha.</p>
          <form className="inventory-form" onSubmit={addItem}>
            <label className="inventory-field">Nome do item
              <input value={itemName} onChange={(event) => setItemName(event.target.value)} required />
            </label>
            <button className="button button--ghost-ink" disabled={actions.createItem.isPending || !itemDraft.trim() || !itemName.trim()}>
              Cadastrar {itemDraft.trim() || "item"}
            </button>
          </form>
          <form className="inventory-form" onSubmit={saveShopItem}>
            <label className="inventory-field">DescriÃ§Ã£o
              <input value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <label className="inventory-field">PreÃ§o em moedas
              <input type="number" min="0" step="1" value={price} onChange={(event) => setPrice(event.target.value)} required />
            </label>
            <label className="inventory-field">Estoque da loja
              <input type="number" min="0" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
            </label>
            <button className="button button--ghost-ink"
              disabled={!userId.trim() || !itemDraft.trim() || !itemName.trim() || actions.saveShopItem.isPending}>
              Salvar na loja
            </button>
          </form>
          {shop.items.data && shop.items.data.length > 0 && (
            <p className="inventory-panel__hint">{shop.items.data.length} item(ns) configurado(s) na loja.</p>
          )}
          {itemId && (
            <form className="inventory-inline inventory-stock-form" onSubmit={addStock}>
              <label className="inventory-field">Quantidade inicial
                <input type="number" min="0" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
              </label>
              <button className="button button--ghost-ink" disabled={actions.createStock.isPending || stock.isSuccess}>
                Criar estoque
              </button>
            </form>
          )}
        </section>

        <section className="paper inventory-panel" aria-labelledby="inventory-character-title">
          <h2 id="inventory-character-title" className="inventory-panel__title">Personagem</h2>
          <p className="inventory-panel__hint">Escolha quem receberá o item e consulte seus itens entregues.</p>
          {characters.isPending && <p>Buscando personagens…</p>}
          {characters.isError && <p className="field-error">{errorMessage(characters.error, "Não foi possível carregar os personagens.")}</p>}
          {characters.isSuccess && characters.data.length === 0 && (
            <p>Esta campanha ainda não tem personagens. <Link to="/personagens/novo">Criar personagem</Link></p>
          )}
          {characters.isSuccess && characters.data.length > 0 && (
            <label className="inventory-field">Personagem da campanha
              <select value={characterId} onChange={(event) => { setCharacterId(event.target.value); setOperationId(""); }}>
                <option value="">Selecione um personagem</option>
                {characters.data.map((character) => (
                  <option key={character.id} value={character.id}>{character.name}{character.active ? "" : " (inativo)"}</option>
                ))}
              </select>
            </label>
          )}
          {characterId && (
            <div className="inventory-owned">
              <h3 className="inventory-panel__sub">Itens recebidos</h3>
              {inventory.isPending && <p>Consultando inventário…</p>}
              {inventory.isError && <p className="field-error">{errorMessage(inventory.error, "Não foi possível consultar o inventário.")}</p>}
              {inventory.isSuccess && inventory.data.length === 0 && <p>Nenhum item recebido.</p>}
              {inventory.isSuccess && inventory.data.length > 0 && (
                <ul className="inventory-owned__list">
                  {inventory.data.map((entry) => (
                    <li key={entry.operationId}><strong>{catalog.items.data?.find((item) => item.itemId === entry.itemId)?.name ?? entry.itemId}</strong><span>× {entry.quantity}</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      <section className="inventory-order" aria-labelledby="inventory-order-title">
        <div>
          <h2 id="inventory-order-title">Pedir um item</h2>
          <p>{itemId && characterId ? `${itemId} para o personagem selecionado.` : "Escolha um item e um personagem para continuar."}</p>
        </div>
        <button type="button" className="button button--brass" onClick={() => void acquire()}
          disabled={!itemId || !characterId || actions.acquire.isPending || stock.data?.available === 0}>
          {actions.acquire.isPending ? "Enviando pedido…" : "Pedir item"}
        </button>
      </section>

      {problem && <p className="field-error field-error--felt inventory-problem" role="alert">{problem}</p>}
      {operationId && (
        <section className="inventory-operation" aria-live="polite">
          <h2>Estado do pedido</h2>
          <p className="inventory-operation__id">Operação {operationId}</p>
          {acquisition.isPending && <p>Aguardando resposta…</p>}
          {acquisition.isError && (
            <div><p>{errorMessage(acquisition.error, "Não foi possível consultar o pedido.")}</p>
              <button type="button" className="button button--ghost-felt button--small" onClick={() => void acquisition.refetch()}>Tentar de novo</button>
            </div>
          )}
          {acquisition.data && (
            <p className={`inventory-operation__status inventory-operation__status--${acquisition.data.status.toLowerCase()}`}>
              {STATUS[acquisition.data.status] ?? acquisition.data.status}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
