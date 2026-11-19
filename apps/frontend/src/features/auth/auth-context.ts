import { createContext, useContext } from "react";
import type { AuthUser, RegisterInput } from "./api";

export interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  signIn(identifier: string, password: string): Promise<void>;
  signUp(input: RegisterInput): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth precisa estar dentro de AuthProvider");
  }

  return value;
}
