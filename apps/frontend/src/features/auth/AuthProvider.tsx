import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { currentUser, endSession, login, register, type AuthUser } from "./api";
import { AuthContext, type AuthContextValue } from "./auth-context";
import {
  accessToken,
  clearSession,
  isUnauthorized,
  onSessionEnded,
  readSession,
  renewSession,
  saveSession,
  saveUser,
} from "./session";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Refresh recusado em qualquer chamada: volta ao login.
  useEffect(() => onSessionEnded(() => setUser(null)), []);

  useEffect(() => {
    let active = true;

    async function restore() {
      const saved = readSession();

      if (!saved) {
        setIsLoading(false);

        return;
      }

      try {
        // accessToken() renova se preciso; a sessão renovada já fica gravada.
        const restored = await currentUser(await accessToken()).catch(async (error: unknown) => {
          // Token ainda no prazo, mas recusado (ex.: o S4 trocou o segredo): renova uma vez.
          if (!isUnauthorized(error)) {
            throw error;
          }

          return currentUser((await renewSession()).tokens.accessToken);
        });
        saveUser(restored);

        if (active) {
          setUser(restored);
        }
      } catch (error) {
        if (isUnauthorized(error)) {
          clearSession();
        } else if (active) {
          // S4 fora do ar ou sem rede: mantém a pessoa logada com o que estava salvo.
          setUser(saved.user);
        }
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
    clearSession();
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
