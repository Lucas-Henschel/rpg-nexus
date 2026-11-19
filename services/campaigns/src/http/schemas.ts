// Formato do que as rotas recebem. Fora disso, a requisição volta com 422 antes de chegar na rota.
import { z } from "zod";

// Identificadores (campanha, usuário, personagem): o UUID e os códigos curtos dos outros serviços.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "use letras, números, _ ou -, até 64");
const text = z.string().trim().min(1).max(80);

/** O `:campaignId` da URL. */
export const CampaignParams = z.object({ campaignId: id });

export const MemberParams = z.object({ campaignId: id, userId: id });

export const CreateCampaignBody = z.object({ name: text });

export const JoinCampaignBody = z.object({
  joinCode: z.string().regex(/^\d{6}$/, "o código tem seis algarismos"),
});

export const ChooseCharacterBody = z.object({
  characterId: id,
  characterName: text,
});
