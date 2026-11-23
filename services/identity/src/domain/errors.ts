export class UserAlreadyExists extends Error {}
export class InvalidCredentials extends Error {}

export class LoginTemporarilyLocked extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("muitas tentativas de login");
  }
}
export class InvalidRefreshToken extends Error {}
export class InvalidAccessToken extends Error {}
export class CampaignHistoryForbidden extends Error {}
export class InvalidHistoryCursor extends Error {}

export class UserInactive extends Error {
  constructor(readonly userId: string) {
    super("usuário desativado");
  }
}
