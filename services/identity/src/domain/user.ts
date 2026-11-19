export interface User {
  userId: string;
  username: string;
  normalizedUsername: string;
  email: string;
  normalizedEmail: string;
  passwordHash: string;
  globalRole: "USER";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PublicUser = Pick<
  User,
  "userId" | "username" | "email" | "globalRole" | "active" | "createdAt" | "updatedAt"
>;

export const toPublicUser = ({
  userId,
  username,
  email,
  globalRole,
  active,
  createdAt,
  updatedAt,
}: User): PublicUser => ({ userId, username, email, globalRole, active, createdAt, updatedAt });
