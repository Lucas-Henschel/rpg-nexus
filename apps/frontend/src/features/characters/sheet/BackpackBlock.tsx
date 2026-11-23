import type { Hold } from "../api";
import type { InventoryEntry, ShopItem } from "../../inventory/api";

type Data = Record<string, unknown>;
interface Column { id: string; title: string }
interface Row { id: string; cells: Record<string, string> }
const defaultColumns: Column[] = [
  { id: "name", title: "Nome" }, { id: "spaces", title: "Espaços" },
  { id: "level", title: "Nível" }, { id: "value", title: "Valor" },
];

export function BackpackBlock({ maxItems, slotsUsed, holds, inventory, shopItems, onChange, data, onData, editing }: {
  maxItems: number; slotsUsed: number; holds: Hold[]; onChange: (maxItems: number) => void;
  inventory: InventoryEntry[]; shopItems: ShopItem[];
  data: Data; onData: (data: Data) => void; editing: boolean;
}) {
  const columns: Column[] = Array.isArray(data.columns) && data.columns.length ? data.columns as Column[] : defaultColumns;
  const rows: Row[] = Array.isArray(data.rows) ? data.rows as Row[] : [];
  const activeHolds = holds.filter(hold => hold.status === "HELD");
  const committedHolds = holds.filter(hold => hold.status === "COMMITTED");
  const reserved = activeHolds.reduce((sum, hold) => sum + hold.quantity, 0);
  const itemById = new Map(shopItems.map(item => [item.itemId, item]));
  const inventoryByOperation = new Map(inventory.map(entry => [entry.operationId, entry]));
  // A projeção de inventário pode chegar depois do evento que confirma a capacidade no S2.
  // Enquanto isso, o hold COMMITTED já identifica o item e permite mostrar a compra na mochila.
  const deliveredItems: InventoryEntry[] = [
    ...inventory,
    ...committedHolds
      .filter(hold => !inventoryByOperation.has(hold.operationId) && hold.itemId)
      .map(hold => ({
        operationId: hold.operationId,
        campaignId: "",
        itemId: hold.itemId as string,
        quantity: hold.quantity,
      })),
  ];
  const manual = rows.reduce((sum, row) => sum + Math.max(0, Number(row.cells?.spaces) || 0), 0);
  const used = Math.max(slotsUsed, manual);
  const saveRow = (id: string, column: string, value: string) =>
    onData({ ...data, rows: rows.map(row => row.id === id ? { ...row, cells: { ...row.cells, [column]: value } } : row) });
  const removeRow = (id: string) => onData({ ...data, rows: rows.filter(row => row.id !== id) });

  return <div className="vital backpack-table">
    <p className="backpack__summary">{used}/{maxItems} espaços usados · {reserved} reservado(s)</p>
    {used > maxItems && <p className="field-error">Capacidade excedida.</p>}
    <div className="backpack-table__scroll"><table>
      <thead><tr>{columns.map(column => <th key={column.id}>
        {editing ? <span className="backpack-table__heading">
          <input aria-label={`Título da coluna ${column.title}`} value={column.title} maxLength={30}
            onChange={event => onData({ ...data, columns: columns.map(c => c.id === column.id ? { ...c, title: event.target.value } : c) })} />
          {column.id !== "name" && column.id !== "spaces" && <button type="button" aria-label={`Remover coluna ${column.title}`}
            onClick={() => onData({ ...data, columns: columns.filter(c => c.id !== column.id) })}>×</button>}
        </span> : column.title}
      </th>)}<th aria-label="Ações" /></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.id}>
        <input type={column.id === "spaces" ? "number" : "text"} min={column.id === "spaces" ? 0 : undefined}
          step={column.id === "spaces" ? 1 : undefined} maxLength={100} aria-label={`${column.title} do item`}
          value={row.cells?.[column.id] ?? ""} onChange={event => saveRow(row.id, column.id, event.target.value)} />
      </td>)}<td><button type="button" className="backpack-table__remove" onClick={() => removeRow(row.id)} aria-label="Remover item">×</button></td></tr>)}
      {deliveredItems.map(entry => {
        const item = itemById.get(entry.itemId);
        const values: Record<string, string> = {
          name: entry.itemName || item?.name || "Item da campanha",
          spaces: String(entry.quantity),
          level: "—",
          value: entry.price !== undefined ? `${entry.price} moedas` : item ? `${item.price} moedas` : "—",
        };
        return <tr key={`inventory-${entry.operationId}`} className="backpack-table__purchased">
          {columns.map(column => <td key={column.id}>{values[column.id] ?? "—"}</td>)}<td />
        </tr>;
      })}</tbody>
    </table></div>
    <div className="backpack-table__actions">
      <button type="button" className="text-button" disabled={rows.length >= 50}
        onClick={() => onData({ ...data, rows: [...rows, { id: crypto.randomUUID(), cells: {} }] })}>Adicionar item</button>
      <label>Máximo <input type="number" min={slotsUsed} max={1000} value={maxItems}
        onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) onChange(event.target.valueAsNumber); }} /></label>
      {editing && <button type="button" className="text-button" disabled={columns.length >= 6}
        onClick={() => onData({ ...data, columns: [...columns, { id: crypto.randomUUID(), title: "Nova coluna" }] })}>Adicionar coluna</button>}
      {editing && <label><input type="checkbox" checked={data.allowOverflow === true}
        onChange={event => onData({ ...data, allowOverflow: event.target.checked })} /> Permitir itens acima do máximo na tabela</label>}
    </div>
    {activeHolds.length > 0 && <ul className="holds">{activeHolds.map(hold => <li key={hold.operationId} className="hold hold--held">
      <span className="hold__item">{itemById.get(hold.itemId ?? "")?.name ?? "Item da campanha"} · {hold.quantity}</span>
      <span className="hold__status">Reservado</span>
    </li>)}</ul>}
  </div>;
}
