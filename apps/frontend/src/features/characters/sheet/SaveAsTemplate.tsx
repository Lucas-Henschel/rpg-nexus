/** Salva a organização atual da ficha como modelo privado, para criar outros personagens a partir dele. */
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../../shared/http";
import { useToast } from "../../../shared/ui/toast-context";
import { useCreateTemplate } from "../queries";
import type { Draft } from "./sheetDraft";

export function SaveAsTemplate({ draft }: { draft: Draft }) {
  const toast = useToast();
  const create = useCreateTemplate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startingMoney, setStartingMoney] = useState("0");

  if (!open) {
    return (
      <button type="button" className="button button--ghost-ink" onClick={() => setOpen(true)}>
        Salvar como modelo
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const money = Number(startingMoney);
    if (!name.trim()) {
      return toast("error", "O modelo precisa de um nome.");
    }

    if (!Number.isSafeInteger(money) || money < 0) {
      return toast("error", "O dinheiro inicial é um inteiro a partir de 0.");
    }

    create.mutate(
      {
        name: name.trim(),
        // Vai a estrutura da ficha; o serviço descarta anotações, listas e o cabeçalho.
        sheetDefinition: draft.sheet,
        initialValues: {
          attributes: draft.attributes,
          skills: draft.skills,
          hpMax: draft.hpMax,
          maxItems: draft.maxItems,
          currency: { name: "Ouro", amount: money },
        },
      },
      {
        onSuccess: (template) => {
          toast("ok", `Modelo "${template.name}" salvo. Ele aparece na criação de personagens.`);
          setOpen(false);
          setName("");
        },
        onError: (error) => toast("error", errorMessage(error, "Não foi possível salvar o modelo.")),
      },
    );
  };

  return (
    <form className="template-save" onSubmit={submit}>
      <label>
        Nome do modelo
        <input className="ink-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
      </label>
      <label>
        Dinheiro inicial
        <input
          className="ink-input"
          type="number"
          min={0}
          step={1}
          value={startingMoney}
          onChange={(e) => setStartingMoney(e.target.value)}
        />
      </label>
      <p className="template-save__hint">
        Vão os blocos, atributos, perícias, vida máxima e mochila. Anotações, listas e o saldo atual
        ficam de fora.
      </p>
      <button type="submit" className="button button--ink" disabled={create.isPending}>
        {create.isPending ? "Salvando…" : "Salvar modelo"}
      </button>
      <button type="button" className="button button--ghost-ink" onClick={() => setOpen(false)}>
        Cancelar
      </button>
    </form>
  );
}
