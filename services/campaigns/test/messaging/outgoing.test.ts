import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/config.js";
import {
  campaignCreated,
  memberCharacterChosen,
  memberJoined,
  memberRemoved,
  type OutboxMessage,
  templateAssigned,
} from "../../src/messaging/outgoing.js";
import { campaign, member, NOW } from "../db/fixtures.js";
import { AUTH_ENV } from "../tokens.js";

const contractsDir = resolve(loadEnv(AUTH_ENV).CONTRACTS_DIR);
const readSchema = (file: string) => JSON.parse(readFileSync(resolve(contractsDir, file), "utf8"));

const ajv = new Ajv2020({ allErrors: true });
addFormatsModule.default(ajv);
ajv.addKeyword("x-routing");
ajv.addSchema(readSchema("envelope.schema.json"));

/** Confere a mensagem com o esquema do contrato e devolve o envelope. */
function expectValid(message: OutboxMessage, schemaFile: string) {
  const schema = readSchema(`events/${schemaFile}`);
  const validate = ajv.getSchema(schema.$id) ?? ajv.compile(schema);
  const envelope = JSON.parse(message.body);

  expect(validate(envelope), ajv.errorsText(validate.errors)).toBe(true);
  expect(message.routingKey).toBe(schema["x-routing"].routingKey);
  expect(message.messageId).toBe(envelope.messageId);
  expect(message.type).toBe(envelope.type);

  return envelope;
}

const CAMPAIGN = campaign({ campaignId: "7c9e6679-7425-40de-944b-e07fc1f90ae7" });

describe("eventos publicados pelo S1", () => {
  it("CampaignCreated segue o contrato", () => {
    const envelope = expectValid(campaignCreated(CAMPAIGN), "campaign-created.v1.schema.json");

    expect(envelope).toMatchObject({
      correlationId: CAMPAIGN.campaignId,
      occurredAt: CAMPAIGN.createdAt,
      payload: {
        campaignId: CAMPAIGN.campaignId,
        name: CAMPAIGN.name,
        ownerId: CAMPAIGN.ownerId,
        ownerName: CAMPAIGN.ownerName,
      },
    });
  });

  it("CampaignMemberJoined segue o contrato", () => {
    const beto = member({ userId: "u-beto", username: "beto", role: "PLAYER" });
    const envelope = expectValid(
      memberJoined(CAMPAIGN.campaignId, beto),
      "campaign-member-joined.v1.schema.json",
    );

    expect(envelope.payload).toEqual({
      campaignId: CAMPAIGN.campaignId,
      userId: "u-beto",
      username: "beto",
      role: "PLAYER",
      joinedAt: beto.joinedAt,
    });
  });

  it("CampaignMemberRemoved segue o contrato", () => {
    const envelope = expectValid(
      memberRemoved(CAMPAIGN.campaignId, {
        userId: "u-beto",
        removedBy: "u-ana",
        reason: "REMOVED",
        removedAt: NOW,
      }),
      "campaign-member-removed.v1.schema.json",
    );

    expect(envelope.payload).toMatchObject({ reason: "REMOVED", removedBy: "u-ana" });
  });

  it("CampaignMemberCharacterChosen segue o contrato", () => {
    const beto = member({ userId: "u-beto", characterId: "ch1", characterName: "Lyra" });
    const envelope = expectValid(
      memberCharacterChosen(CAMPAIGN.campaignId, beto),
      "campaign-member-character-chosen.v1.schema.json",
    );

    expect(envelope.payload).toEqual({
      campaignId: CAMPAIGN.campaignId,
      userId: "u-beto",
      role: "PLAYER",
      characterId: "ch1",
      characterName: "Lyra",
    });
  });

  it("CampaignTemplateAssigned segue o contrato", () => {
    const envelope = expectValid(
      templateAssigned(CAMPAIGN.campaignId, "u-ana", {
        templateId: "t-aventureiro",
        version: 3,
        name: "Aventureiro de Ooo",
        assignedAt: NOW,
      }),
      "campaign-template-assigned.v1.schema.json",
    );

    expect(envelope).toMatchObject({
      correlationId: CAMPAIGN.campaignId,
      occurredAt: NOW,
      payload: {
        campaignId: CAMPAIGN.campaignId,
        templateId: "t-aventureiro",
        templateVersion: 3,
        templateName: "Aventureiro de Ooo",
        assignedBy: "u-ana",
        assignedAt: NOW,
      },
    });
  });

  it("cada evento ganha um messageId novo", () => {
    expect(campaignCreated(CAMPAIGN).messageId).not.toBe(campaignCreated(CAMPAIGN).messageId);
  });
});
