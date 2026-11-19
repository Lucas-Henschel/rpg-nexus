import { describe, expect, it, vi } from "vitest";
import {
  CampaignNotFound,
  CharacterInUse,
  JoinCodeNotFound,
  MemberNotFound,
  NotCampaignMember,
  NotCampaignOwner,
  OwnerCannotLeave,
} from "../../src/domain/errors.js";
import { createCampaignService } from "../../src/services/campaigns.js";
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
