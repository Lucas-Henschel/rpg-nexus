export interface Session {
  sessionId: string;
  userId: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
}
