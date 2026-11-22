import { useState, type FormEvent } from "react";
import { createCharacter, createFromTemplate, type SavedTemplate } from "./api";
import { useDeleteTemplate, useTemplates } from "./queries";
import { errorMessage } from "../../shared/http";
import { useCampaign } from "../../shared/campaign";
import { cx } from "../../shared/ui/cx";
import { useToast } from "../../shared/ui/toast-context";
import { navigate } from "../../app/navigation";
import { Link } from "../../app/router";
import { sheetFromTemplate, TEMPLATES, type Template } from "./sheet/templates";
import { useAuth } from "../auth/auth-context";
import { useCampaigns } from "../campaigns/queries";

function TemplateIcon({ icon }: { icon: Template["icon"] }) {
  const paths: Record<Template["icon"], string> = {
    blank: "M32 18v28M18 32h28",
    sword: "M46 10 22 34l8 8 24-24V10zM22 34l-6 6m14 2-6 6M14 42l8 8M12 52l6-6",
    eye: "M6 32c8-12 17-18 26-18s18 6 26 18c-8 12-17 18-26 18S14 44 6 32zM32 24a8 8 0 1 0 0 16 8 8 0 0 0 0-16z",
    planet:
      "M32 16a16 16 0 1 0 0 32 16 16 0 0 0 0-32zM13 42C6 47 4 51 6 53c3 3 16-3 29-13s22-21 20-25c-1-2-5-1-11 2",
    feather: "M52 10C34 12 20 24 16 44l-4 10M16 44c10-2 22-8 30-20M24 34h14M30 26h14",
  };

  return (
    <svg className="template__icon" viewBox="0 0 64 64" aria-hidden="true">
      <path d={paths[icon]} />
    </svg>
  );
}

/** Modelos que a pessoa salvou no S2 a partir das próprias fichas. */
function SavedTemplates({
  chosen,
  onChoose,
}: {
  chosen: string;
  onChoose: (templateId: string) => void;
}) {
  const toast = useToast();
  const templates = useTemplates();
  const remove = useDeleteTemplate();

  if (templates.isError) {
    return <p className="field-error field-error--felt">{errorMessage(templates.error, "Não foi possível carregar seus modelos.")}</p>;
  }

  if (!templates.data?.length) {
    return (
      <p className="page__lead">
        Você ainda não salvou modelos. Numa ficha pronta, use “Salvar como modelo” para reaproveitar a organização dela.
      </p>
    );
  }

  const onDelete = (template: SavedTemplate) => {
    remove.mutate(template.templateId, {
      onSuccess: () => toast("ok", `Modelo "${template.name}" apagado. Fichas criadas com ele não mudam.`),
      onError: (error) => toast("error", errorMessage(error, "Não foi possível apagar o modelo.")),
    });
  };

  return (
    <div className="templates" role="radiogroup" aria-label="Meus modelos">
      {templates.data.map((item) => {
        const value = `saved:${item.templateId}`;
        const blocks = item.sheetDefinition?.columns.flat().length ?? 0;

        return (
          <label key={item.templateId} className={cx("template", value === chosen && "template--chosen")}>
            <input type="radio" name="template" value={value} checked={value === chosen} onChange={() => onChoose(value)} />
            <span className="template__name">{item.name}</span>
            <span className="template__summary">{item.description || "Modelo salvo por você"}</span>
            <span className="template__meta">
              Versão {item.version} · {blocks} blocos · {item.initialValues.currency.amount} {item.initialValues.currency.name}
            </span>
            <button
              type="button"
              className="button button--ghost-ink template__delete"
              onClick={(event) => {
                event.preventDefault();
                onDelete(item);
              }}
              disabled={remove.isPending}
            >
              Apagar modelo
            </button>
          </label>
        );
      })}
    </div>
  );
}

export function NewCharacterPage() {
  const { user } = useAuth();
  const userId = user?.userId ?? "";
  const campaigns = useCampaigns(userId);
  const [storedCampaign] = useCampaign(user?.userId);
  const campaign = campaigns.isSuccess
    ? campaigns.data.find((item) => item.campaignId === storedCampaign)?.campaignId ?? campaigns.data[0]?.campaignId ?? ""
    : "";
  const toast = useToast();
  // "saved:<id>" é um modelo salvo no S2; o resto são os modelos prontos do front.
  const [templateId, setTemplateId] = useState(TEMPLATES[0].id);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const template = TEMPLATES.find((t) => t.id === templateId) ?? TEMPLATES[0];
  const savedId = templateId.startsWith("saved:") ? templateId.slice("saved:".length) : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      return setProblem("O personagem precisa de um nome.");
    }

    setSaving(true);
    setProblem("");
    try {
      const created = savedId
        ? await createFromTemplate(savedId, { campaignId: campaign, name: name.trim() })
        : await createCharacter({
            campaignId: campaign,
            name: name.trim(),
            attributes: template.attributes,
            skills: template.skills,
            hp: { current: template.hpMax, max: template.hpMax },
            maxItems: template.maxItems,
            sheet: sheetFromTemplate(template),
          });
      toast("ok", `${created.name} criado.`);
      navigate(`/personagens/${created.id}`);
    } catch (error) {
      setProblem(errorMessage(error, "Não foi possível criar o personagem."));
      setSaving(false);
    }
  };

  return (
    <main className="page">
      <Link to="/personagens" className="back-link">
        Voltar aos personagens
      </Link>
      <h1 className="page__title">Escolha o modelo da ficha</h1>
      <p className="page__lead">
        O modelo é só o ponto de partida. Depois de criar, você muda, tira e acrescenta o que
        quiser.
      </p>

      <form onSubmit={submit} noValidate>
        <div className="templates" role="radiogroup" aria-label="Modelo da ficha">
          {TEMPLATES.map((item) => {
            const blocks = item.columns.flat().length;

            return (
              <label
                key={item.id}
                className={cx(
                  "template",
                  item.id === templateId && "template--chosen",
                  item.icon === "blank" && "template--blank",
                )}
              >
                <input
                  type="radio"
                  name="template"
                  value={item.id}
                  checked={item.id === templateId}
                  onChange={() => setTemplateId(item.id)}
                />
                <TemplateIcon icon={item.icon} />
                <span className="template__name">{item.name}</span>
                <span className="template__summary">{item.summary}</span>
                <span className="template__meta">
                  {blocks === 0
                    ? "Nenhum bloco pronto"
                    : `${blocks} blocos prontos, ${Object.keys(item.attributes).length} atributos`}
                </span>
              </label>
            );
          })}
        </div>

        <h2 className="section-title">Meus modelos</h2>
        <SavedTemplates chosen={templateId} onChoose={setTemplateId} />

        {!campaign && <p className="field-error field-error--felt">{campaigns.isPending ? "Carregando suas campanhas…" : campaigns.isError ? errorMessage(campaigns.error, "Não foi possível carregar suas campanhas.") : <>Você precisa participar de uma campanha. <Link to="/campanhas">Ver campanhas</Link></>}</p>}
        <div className="create-bar">
          <label className="create-bar__name">
            <span>Nome do personagem</span>
            <input
              className="felt-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </label>
          <button type="submit" className="button button--brass" disabled={saving || !campaign}>
            {saving ? "Criando…" : campaign ? `Criar personagem na campanha ${campaign}` : "Selecione uma campanha para continuar"}
          </button>
        </div>
        {problem && <p className="field-error field-error--felt">{problem}</p>}
      </form>
    </main>
  );
}
