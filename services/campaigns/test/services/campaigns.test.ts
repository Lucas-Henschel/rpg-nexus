import { describe, expect, it, vi } from "vitest";
import {
  CampaignNotFound,
  CharacterInUse,
  JoinCodeNotFound,
  MemberNotFound,
  NotCampaignMember,
  NotCampaignOwner,
  OwnerCannotLeave,
  TemplateNotFound,
} from "../../src/domain/errors.js";
import { createCampaignService, type TemplateCatalog } from "../../src/services/campaigns.js";
import { fakeRepositories } from "../fake-repositories.js";

const NOW = "2026-11-16T12:00:00.000Z";
const ANA = { userId: "u-ana", username: "ana" };
const BETO = { userId: "u-beto", username: "beto" };
const CAIO = { userId: "u-caio", username: "caio" };

/** Códigos sorteados em sequência, para o teste saber qual sai. */
const codes = (...values: string[]) => {
  const queue = [...values];

  return () => queue.shift() ?? "999999";
};

const testService = (joinCode = codes("482731", "000417", "120000")) =>
  createCampaignService(fakeRepositories(), { clock: () => NOW, joinCode });

describe("create", () => {
  it("quem cria vira dono e OWNER; a campanha ganha um UUID e um código de seis dígitos", async () => {
    const service = testService();

    const campaign = await service.create({ name: "A Coroa de Cinzas" }, ANA);

    expect(campaign).toEqual({
      campaignId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "A Coroa de Cinzas",
      ownerId: "u-ana",
      ownerName: "ana",
      joinCode: "482731",
      createdAt: NOW,
      template: null,
    });
    expect((await service.get(campaign.campaignId, ANA)).members).toEqual([
      {
        userId: "u-ana",
        username: "ana",
        role: "OWNER",
        characterId: null,
        characterName: null,
        itemsAcquired: 0,
        joinedAt: NOW,
      },
    ]);
  });

  it("código repetido: sorteia outro", async () => {
    const service = testService(codes("482731", "482731", "000417"));

    await service.create({ name: "Um" }, ANA);
    const second = await service.create({ name: "Dois" }, BETO);

    expect(second.joinCode).toBe("000417");
  });

  it("depois de cinco códigos repetidos, desiste com erro", async () => {
    const service = testService(codes("111111", "111111", "111111", "111111", "111111", "111111"));

    await service.create({ name: "Um" }, ANA);

    await expect(service.create({ name: "Dois" }, BETO)).rejects.toThrow(/código/);
  });
});

describe("listMine", () => {
  it("só as campanhas de que o usuário participa, da mais antiga para a mais nova", async () => {
    const service = testService();

    const um = await service.create({ name: "Um" }, ANA);
    await service.create({ name: "Dois" }, BETO);
    await service.join(um.joinCode, BETO);

    expect((await service.listMine(ANA)).map((c) => c.name)).toEqual(["Um"]);
    expect((await service.listMine(BETO)).map((c) => c.name).sort()).toEqual(["Dois", "Um"]);
    expect(await service.listMine(CAIO)).toEqual([]);
  });
});

describe("get", () => {
  it("quem não participa → NotCampaignMember", async () => {
    const service = testService();
    const campaign = await service.create({ name: "Um" }, ANA);

    await expect(service.get(campaign.campaignId, BETO)).rejects.toBeInstanceOf(NotCampaignMember);
  });

  it("campanha inexistente → CampaignNotFound", async () => {
    await expect(testService().get("nao-existe", ANA)).rejects.toBeInstanceOf(CampaignNotFound);
  });
});

describe("join", () => {
  it("entra como PLAYER; repetir não duplica", async () => {
    const service = testService();
    const campaign = await service.create({ name: "Um" }, ANA);

    const first = await service.join("482731", BETO);
    const second = await service.join("482731", BETO);

    expect(first).toEqual({ campaign, created: true });
    expect(second).toEqual({ campaign, created: false });
    expect((await service.get(campaign.campaignId, BETO)).members).toEqual([
      expect.objectContaining({ userId: "u-ana", role: "OWNER" }),
      expect.objectContaining({ userId: "u-beto", username: "beto", role: "PLAYER" }),
    ]);
  });

  it("o dono usando o próprio código continua OWNER", async () => {
    const service = testService();
    const campaign = await service.create({ name: "Um" }, ANA);

    expect(await service.join("482731", ANA)).toEqual({ campaign, created: false });
    expect((await service.get(campaign.campaignId, ANA)).members[0]?.role).toBe("OWNER");
  });

  it("código que não existe → JoinCodeNotFound", async () => {
    await expect(testService().join("000000", BETO)).rejects.toBeInstanceOf(JoinCodeNotFound);
  });
});

describe("chooseCharacter", () => {
  const lyra = { characterId: "ch1", characterName: "Lyra" };

  it("grava o personagem no participante", async () => {
    const service = testService();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    expect(await service.chooseCharacter(campaignId, ANA, lyra)).toMatchObject({
      userId: "u-ana",
      characterId: "ch1",
      characterName: "Lyra",
    });
  });

  it("personagem já usado por outro participante → CharacterInUse", async () => {
    const service = testService();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.join("482731", BETO);
    await service.chooseCharacter(campaignId, ANA, lyra);

    await expect(service.chooseCharacter(campaignId, BETO, lyra)).rejects.toBeInstanceOf(
      CharacterInUse,
    );
  });

  it("escolher de novo o mesmo personagem não é conflito", async () => {
    const service = testService();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.chooseCharacter(campaignId, ANA, lyra);

    await expect(service.chooseCharacter(campaignId, ANA, lyra)).resolves.toMatchObject(lyra);
  });

  it("quem não participa → NotCampaignMember", async () => {
    const service = testService();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await expect(service.chooseCharacter(campaignId, BETO, lyra)).rejects.toBeInstanceOf(
      NotCampaignMember,
    );
  });
});

describe("removeMember", () => {
  async function campaignWithPlayers() {
    const service = testService();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.join("482731", BETO);
    await service.join("482731", CAIO);

    const userIds = async () =>
      (await service.get(campaignId, ANA)).members.map((member) => member.userId);

    return { service, campaignId, userIds };
  }

  it("o jogador sai da campanha", async () => {
    const { service, campaignId, userIds } = await campaignWithPlayers();

    await service.removeMember(campaignId, BETO, "u-beto");

    expect(await userIds()).toEqual(["u-ana", "u-caio"]);
  });

  it("o dono remove um jogador", async () => {
    const { service, campaignId, userIds } = await campaignWithPlayers();

    await service.removeMember(campaignId, ANA, "u-caio");

    expect(await userIds()).toEqual(["u-ana", "u-beto"]);
  });

  it("um jogador não remove outro → NotCampaignOwner", async () => {
    const { service, campaignId } = await campaignWithPlayers();

    await expect(service.removeMember(campaignId, BETO, "u-caio")).rejects.toBeInstanceOf(
      NotCampaignOwner,
    );
  });

  it("o dono não sai → OwnerCannotLeave", async () => {
    const { service, campaignId } = await campaignWithPlayers();

    await expect(service.removeMember(campaignId, ANA, "u-ana")).rejects.toBeInstanceOf(
      OwnerCannotLeave,
    );
  });

  it("remover quem não participa → MemberNotFound", async () => {
    const { service, campaignId } = await campaignWithPlayers();

    await expect(service.removeMember(campaignId, ANA, "u-zeca")).rejects.toBeInstanceOf(
      MemberNotFound,
    );
  });
});

describe("recordAcquisition", () => {
  const acquisition = (campaignId: string) => ({
    messageId: "m1",
    occurredAt: "2026-11-16T11:00:00Z",
    operationId: "op1",
    campaignId,
    characterId: "ch1",
    itemId: "sword",
    quantity: 1,
  });

  it("conta para o participante que usa o personagem", async () => {
    const repositories = fakeRepositories();
    const record = vi.spyOn(repositories.acquisitions, "record");
    const service = createCampaignService(repositories, { clock: () => NOW, joinCode: codes("1") });
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.chooseCharacter(campaignId, ANA, { characterId: "ch1", characterName: "Lyra" });

    expect(await service.recordAcquisition(acquisition(campaignId))).toBe("applied");
    expect(record).toHaveBeenCalledWith(acquisition(campaignId), NOW, "u-ana");
  });

  it("personagem que ninguém escolheu: registra a atividade sem participante", async () => {
    const repositories = fakeRepositories();
    const record = vi.spyOn(repositories.acquisitions, "record");
    const service = createCampaignService(repositories, { clock: () => NOW, joinCode: codes("1") });
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.recordAcquisition(acquisition(campaignId));

    expect(record).toHaveBeenCalledWith(acquisition(campaignId), NOW, null);
  });
});

describe("eventos na outbox", () => {
  function withOutbox() {
    const repositories = fakeRepositories();
    const service = createCampaignService(repositories, {
      clock: () => NOW,
      joinCode: codes("482731"),
    });
    const events = () =>
      repositories.outbox.map((message) => {
        const { type, payload } = JSON.parse(message.body);

        return { type, payload };
      });

    return { service, events, messages: () => repositories.outbox };
  }

  it("criar publica CampaignCreated e a entrada do dono como OWNER", async () => {
    const { service, events } = withOutbox();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    expect(events()).toEqual([
      { type: "rpg.campaign.created.v1", payload: expect.objectContaining({ campaignId }) },
      {
        type: "rpg.campaign.member.joined.v1",
        payload: expect.objectContaining({ campaignId, userId: "u-ana", role: "OWNER" }),
      },
    ]);
  });

  it("entrar publica CampaignMemberJoined uma vez só", async () => {
    const { service, events } = withOutbox();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.join("482731", BETO);
    await service.join("482731", BETO);

    expect(events().slice(2)).toEqual([
      {
        type: "rpg.campaign.member.joined.v1",
        payload: expect.objectContaining({ campaignId, userId: "u-beto", role: "PLAYER" }),
      },
    ]);
  });

  it("sair publica CampaignMemberRemoved com LEFT; ser removido, com REMOVED", async () => {
    const { service, events } = withOutbox();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.join("482731", BETO);
    await service.join("482731", CAIO);
    await service.removeMember(campaignId, BETO, "u-beto");
    await service.removeMember(campaignId, ANA, "u-caio");

    expect(events().slice(4)).toEqual([
      {
        type: "rpg.campaign.member.removed.v1",
        payload: {
          campaignId,
          userId: "u-beto",
          removedBy: "u-beto",
          reason: "LEFT",
          removedAt: NOW,
        },
      },
      {
        type: "rpg.campaign.member.removed.v1",
        payload: {
          campaignId,
          userId: "u-caio",
          removedBy: "u-ana",
          reason: "REMOVED",
          removedAt: NOW,
        },
      },
    ]);
  });

  it("escolher personagem publica CampaignMemberCharacterChosen com a hora do relógio", async () => {
    const { service, events, messages } = withOutbox();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.join("482731", BETO);
    await service.chooseCharacter(campaignId, BETO, { characterId: "ch1", characterName: "Lyra" });

    expect(events().slice(3)).toEqual([
      {
        type: "rpg.campaign.member.character-chosen.v1",
        payload: {
          campaignId,
          userId: "u-beto",
          role: "PLAYER",
          characterId: "ch1",
          characterName: "Lyra",
        },
      },
    ]);
    expect(JSON.parse(messages().at(-1)!.body).occurredAt).toBe(NOW);
  });

  it("escolher de novo o mesmo personagem não publica outro evento", async () => {
    const { service, events } = withOutbox();
    const { campaignId } = await service.create({ name: "Um" }, ANA);
    const lyra = { characterId: "ch1", characterName: "Lyra" };

    await service.chooseCharacter(campaignId, ANA, lyra);
    await service.chooseCharacter(campaignId, ANA, lyra);
    await service.chooseCharacter(campaignId, ANA, { characterId: "ch2", characterName: "Borin" });

    expect(
      events()
        .slice(2)
        .map((event) => event.payload.characterId),
    ).toEqual(["ch1", "ch2"]);
  });

  it("recusas não publicam nada", async () => {
    const { service, events } = withOutbox();
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.join("482731", BETO);
    await expect(service.removeMember(campaignId, ANA, "u-ana")).rejects.toThrow();
    await expect(service.removeMember(campaignId, BETO, "u-ana")).rejects.toThrow();

    expect(events()).toHaveLength(3);
  });
});

describe("assignTemplate", () => {
  const ANA_TOKEN = "Bearer token-da-ana";

  /** O S2 de mentira: só a ANA vê o modelo t-aventureiro, que está na versão 3. */
  function fakeTemplates() {
    const calls: unknown[][] = [];
    const templates: TemplateCatalog = {
      async find(templateId, version, authorization) {
        calls.push([templateId, version, authorization]);

        if (templateId !== "t-aventureiro" || authorization !== ANA_TOKEN) {
          return null;
        }

        return { templateId, version: version ?? 3, name: "Aventureiro de Ooo" };
      },
    };

    return { templates, calls };
  }

  async function withCampaign() {
    const repositories = fakeRepositories();
    const { templates, calls } = fakeTemplates();
    const service = createCampaignService(repositories, {
      clock: () => NOW,
      joinCode: codes("482731"),
      templates,
    });
    const { campaignId } = await service.create({ name: "Um" }, ANA);

    await service.join("482731", BETO);

    const events = () =>
      repositories.outbox
        .map((message) => JSON.parse(message.body))
        .filter(({ type }) => type === "rpg.campaign.template.assigned.v1")
        .map(({ payload }) => payload);

    return { service, campaignId, calls, events };
  }

  it("o dono define o modelo; sem versão, fica a atual do S2", async () => {
    const { service, campaignId, events } = await withCampaign();

    const campaign = await service.assignTemplate(
      campaignId,
      ANA,
      { templateId: "t-aventureiro" },
      ANA_TOKEN,
    );

    const template = {
      templateId: "t-aventureiro",
      version: 3,
      name: "Aventureiro de Ooo",
      assignedAt: NOW,
    };

    expect(campaign.template).toEqual(template);
    expect((await service.get(campaignId, BETO)).template).toEqual(template);
    expect(events()).toEqual([
      {
        campaignId,
        templateId: "t-aventureiro",
        templateVersion: 3,
        templateName: "Aventureiro de Ooo",
        assignedBy: "u-ana",
        assignedAt: NOW,
      },
    ]);
  });

  it("com versão, fica a versão pedida", async () => {
    const { service, campaignId, calls } = await withCampaign();

    const campaign = await service.assignTemplate(
      campaignId,
      ANA,
      { templateId: "t-aventureiro", version: 2 },
      ANA_TOKEN,
    );

    expect(campaign.template?.version).toBe(2);
    expect(calls).toEqual([["t-aventureiro", 2, ANA_TOKEN]]);
  });

  it("definir de novo o mesmo modelo e versão não publica outro evento", async () => {
    const { service, campaignId, events } = await withCampaign();
    const choice = { templateId: "t-aventureiro", version: 2 };

    await service.assignTemplate(campaignId, ANA, choice, ANA_TOKEN);
    await service.assignTemplate(campaignId, ANA, choice, ANA_TOKEN);
    await service.assignTemplate(campaignId, ANA, { ...choice, version: 3 }, ANA_TOKEN);

    expect(events().map((payload) => payload.templateVersion)).toEqual([2, 3]);
  });

  it("um jogador não define → NotCampaignOwner, sem perguntar ao S2", async () => {
    const { service, campaignId, calls, events } = await withCampaign();

    await expect(
      service.assignTemplate(campaignId, BETO, { templateId: "t-aventureiro" }, "Bearer beto"),
    ).rejects.toBeInstanceOf(NotCampaignOwner);
    expect(calls).toEqual([]);
    expect(events()).toEqual([]);
  });

  it("quem não participa → NotCampaignMember", async () => {
    const { service, campaignId } = await withCampaign();

    await expect(
      service.assignTemplate(campaignId, CAIO, { templateId: "t-aventureiro" }, "Bearer caio"),
    ).rejects.toBeInstanceOf(NotCampaignMember);
  });

  it("modelo que o dono não tem no S2 → TemplateNotFound", async () => {
    const { service, campaignId, events } = await withCampaign();

    await expect(
      service.assignTemplate(campaignId, ANA, { templateId: "t-de-outro" }, ANA_TOKEN),
    ).rejects.toBeInstanceOf(TemplateNotFound);
    expect(events()).toEqual([]);
  });
});
