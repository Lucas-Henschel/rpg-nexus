import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  currentUser,
  endSession,
  login,
  register,
  refreshSession,
  type AuthSession,
  type AuthTokens,
  type AuthUser,
} from "./api";
import { AuthContext, type AuthContextValue } from "./auth-context";

const STORAGE_KEY = "rpg-nexus.auth";

function readSession(): AuthSession | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    return stored ? (JSON.parse(stored) as AuthSession) : null;
  } catch {
    localStorage.removeItem(STORAGE_KEY);

    return null;
  }
}

function saveSession(user: AuthUser, tokens: AuthTokens): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ user, tokens } satisfies AuthSession));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function restore() {
      const saved = readSession();
      if (!saved) {
        setIsLoading(false);

        return;
      }

      try {
        let tokens = saved.tokens;
        let restoredUser: AuthUser;
        try {
          restoredUser = await currentUser(tokens.accessToken);
        } catch {
          tokens = await refreshSession(tokens.refreshToken);
          restoredUser = await currentUser(tokens.accessToken);
        }

        if (active) {
          saveSession(restoredUser, tokens);
          setUser(restoredUser);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void restore();

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const session = await login(identifier, password);
    saveSession(session.user, session.tokens);
    setUser(session.user);
  }, []);

  const signUp = useCallback(async (input: Parameters<typeof register>[0]) => {
    const session = await register(input);
    saveSession(session.user, session.tokens);
    setUser(session.user);
  }, []);

  const signOut = useCallback(async () => {
    const session = readSession();
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);

    if (session) {
      try {
        await endSession(session.tokens.refreshToken);
      } catch {
        // A sessão local já foi encerrada; o serviço pode estar indisponível.
      }
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, signIn, signUp, signOut }),
    [isLoading, signIn, signOut, signUp, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
