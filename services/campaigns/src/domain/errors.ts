export class CampaignAlreadyExists extends Error {
  constructor(readonly campaignId: string) {
    super(`a campanha ${campaignId} já existe`);
  }
}

export class CampaignNotFound extends Error {
  constructor(readonly campaignId: string) {
    super(`a campanha ${campaignId} não existe`);
  }
}
