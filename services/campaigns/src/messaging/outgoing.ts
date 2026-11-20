// Eventos que o S1 publica, já no envelope de contracts/. Vão para a outbox na mesma transação da
// mudança, e o relay da outbox os publica depois.
import { randomUUID } from "node:crypto";
import type { AssignedTemplate, Campaign } from "../domain/campaign.js";
import type { Member } from "../domain/member.js";
import { traceHeaders } from "../tracing/spans.js";

/** Um evento pronto para publicar, como fica gravado na outbox. */
export interface OutboxMessage {
  messageId: string;
  type: string;
  routingKey: string;
  /** O envelope em JSON, exatamente como vai para o RabbitMQ. */
  body: string;
  /** `traceparent` de quem gerou o evento, para a publicação continuar o mesmo trace. */
  headers: Record<string, string>;
  createdAt: string;
}

export interface Removal {
  userId: string;
  removedBy: string;
  reason: "LEFT" | "REMOVED";
  removedAt: string;
}

/** `rpg.campaign.created.v1` vai pela routing key `campaign.created.v1`. */
function outboxMessage(
  type: string,
  campaignId: string,
  occurredAt: string,
  payload: object,
): OutboxMessage {
  const messageId = randomUUID();
  const envelope = { messageId, correlationId: campaignId, type, version: 1, occurredAt, payload };

  return {
    messageId,
    type,
    routingKey: type.replace(/^rpg\./, ""),
    body: JSON.stringify(envelope),
    headers: traceHeaders(),
    createdAt: occurredAt,
  };
}

export const campaignCreated = (campaign: Campaign): OutboxMessage =>
  outboxMessage("rpg.campaign.created.v1", campaign.campaignId, campaign.createdAt, {
    campaignId: campaign.campaignId,
    name: campaign.name,
    ownerId: campaign.ownerId,
    ownerName: campaign.ownerName,
    createdAt: campaign.createdAt,
  });

export const memberJoined = (campaignId: string, member: Member): OutboxMessage =>
  outboxMessage("rpg.campaign.member.joined.v1", campaignId, member.joinedAt, {
    campaignId,
    userId: member.userId,
    username: member.username,
    role: member.role,
    joinedAt: member.joinedAt,
  });

export const memberCharacterChosen = (
  campaignId: string,
  member: Member,
  chosenAt: string,
): OutboxMessage =>
  outboxMessage("rpg.campaign.member.character-chosen.v1", campaignId, chosenAt, {
    campaignId,
    userId: member.userId,
    role: member.role,
    characterId: member.characterId,
    characterName: member.characterName,
  });

export const memberRemoved = (campaignId: string, removal: Removal): OutboxMessage =>
  outboxMessage("rpg.campaign.member.removed.v1", campaignId, removal.removedAt, {
    campaignId,
    ...removal,
  });

export const templateAssigned = (
  campaignId: string,
  assignedBy: string,
  template: AssignedTemplate,
): OutboxMessage =>
  outboxMessage("rpg.campaign.template.assigned.v1", campaignId, template.assignedAt, {
    campaignId,
    templateId: template.templateId,
    templateVersion: template.version,
    templateName: template.name,
    assignedBy,
    assignedAt: template.assignedAt,
  });
