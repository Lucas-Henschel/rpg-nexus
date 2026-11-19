/** OWNER criou a campanha e a administra; PLAYER entrou pelo código. */
export type Role = "OWNER" | "PLAYER";

/** Um usuário participando de uma campanha, com o personagem que escolheu usar nela. */
export interface Member {
  userId: string;
  username: string;
  role: Role;
  /** null até o participante escolher o personagem. */
  characterId: string | null;
  characterName: string | null;
  itemsAcquired: number;
  joinedAt: string;
}
