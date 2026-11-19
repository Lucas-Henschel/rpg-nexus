export class UserAlreadyExists extends Error {}
export class InvalidCredentials extends Error {}
export class InvalidRefreshToken extends Error {}
export class InvalidAccessToken extends Error {}

export class UserInactive extends Error {
  constructor(readonly userId: string) {
    super("usuário desativado");
  }
}
