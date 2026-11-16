// Formato do que as rotas recebem. Fora disso, a requisição volta com 422 antes de chegar na rota.
import { z } from "zod";

// Mesmo padrão de código que o front usa.
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "use letras, números, _ ou -, até 64");
const text = z.string().trim().min(1).max(80);

/** O `:campaignId` da URL. */
export const CampaignParams = z.object({ campaignId: id });

export const CreateCampaignBody = z.object({
  name: text,
  gameMaster: text.optional(),
  campaignId: id.optional(),
});

export const AddMemberBody = z.object({
  characterId: id,
  characterName: text,
});
