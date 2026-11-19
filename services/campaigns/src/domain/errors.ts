export class CampaignNotFound extends Error {
  constructor(readonly campaignId: string) {
    super(`a campanha ${campaignId} não existe`);
  }
}

/** Nenhuma campanha usa esse código de entrada. */
export class JoinCodeNotFound extends Error {
  constructor(readonly joinCode: string) {
    super(`nenhuma campanha com o código ${joinCode}`);
  }
}

/** O código sorteado já é de outra campanha; quem cria sorteia outro. */
export class JoinCodeTaken extends Error {
  constructor(readonly joinCode: string) {
    super(`o código ${joinCode} já está em uso`);
  }
}

/** Requisição sem token, ou com token inválido ou expirado. */
export class Unauthenticated extends Error {
  constructor() {
    super("token ausente ou inválido");
  }
}

export class NotCampaignMember extends Error {
  constructor(readonly campaignId: string) {
    super(`você não participa da campanha ${campaignId}`);
  }
}

export class NotCampaignOwner extends Error {
  constructor(readonly campaignId: string) {
    super(`só o dono da campanha ${campaignId} pode fazer isso`);
  }
}

export class MemberNotFound extends Error {
  constructor(
    readonly campaignId: string,
    readonly userId: string,
  ) {
    super(`o usuário ${userId} não participa da campanha ${campaignId}`);
  }
}

/** O dono não sai nem é removido: a campanha ficaria sem ninguém para administrá-la. */
export class OwnerCannotLeave extends Error {
  constructor(readonly campaignId: string) {
    super(`o dono não pode sair da campanha ${campaignId}`);
  }
}

/** Outro participante já usa esse personagem na campanha. */
export class CharacterInUse extends Error {
  constructor(
    readonly campaignId: string,
    readonly characterId: string,
  ) {
    super(`o personagem ${characterId} já é usado na campanha ${campaignId}`);
  }
}
