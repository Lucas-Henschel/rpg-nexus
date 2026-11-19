import { useState, type FormEvent } from "react";
import { Logo } from "../../app/Header";
import { navigate } from "../../app/navigation";
import { errorMessage } from "../../shared/http";
import { useAuth } from "./auth-context";

export function LoginPage({ returnTo = "/" }: { returnTo?: string }) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [problem, setProblem] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProblem("");
    setIsSubmitting(true);

    try {
      if (mode === "register") {
        if (password !== passwordConfirmation) {
          setProblem("As senhas não coincidem.");

          return;
        }

        await signUp({ username: username.trim(), email: email.trim(), password });
      } else {
        await signIn(identifier.trim(), password);
      }

      navigate(returnTo === "/login" ? "/" : returnTo);
    } catch (error) {
      const fallback =
        mode === "register" ? "Não foi possível criar a conta." : "Não foi possível entrar.";
      setProblem(errorMessage(error, `${fallback} Tente novamente.`));
    } finally {
      setIsSubmitting(false);
    }
  }

  function changeMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setProblem("");
    setPassword("");
    setPasswordConfirmation("");
    setShowPassword(false);
  }

  const isRegister = mode === "register";
  let submitLabel = isRegister ? "Criar conta" : "Entrar no RPG Nexus";
  if (isSubmitting) {
    submitLabel = isRegister ? "Criando sua conta…" : "Abrindo o portal…";
  }

  return (
    <main className="login-page">
      <section className="login-intro" aria-labelledby="login-title">
        <div className="login-brand">
          <Logo />
          <span>RPG Nexus</span>
        </div>
        <p className="login-eyebrow">Sua mesa, reunida em um só lugar</p>
        <h1 id="login-title">A aventura continua daqui.</h1>
        <p className="login-intro__text">
          Entre para acompanhar campanhas, fichas de personagens e os itens conquistados pelo seu
          grupo.
        </p>
        <blockquote className="login-quote">
          <span>“Toda grande história começa quando o grupo se reúne.”</span>
        </blockquote>
      </section>

      <section className="login-card" aria-label="Acesso à conta">
        <div className="login-card__ornament" aria-hidden="true">
          <span />
          <svg viewBox="0 0 32 32">
            <path d="M16 2 29 9.5v13L16 30 3 22.5v-13z" />
            <path d="M16 8l7 12H9z" />
          </svg>
          <span />
        </div>
        <div className="login-tabs" role="tablist" aria-label="Acesso">
          <button
            type="button"
            role="tab"
            aria-selected={!isRegister}
            onClick={() => changeMode("login")}
          >
            Entrar
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isRegister}
            onClick={() => changeMode("register")}
          >
            Criar conta
          </button>
        </div>

        <h2>{isRegister ? "Reúna seu grupo" : "Bem-vindo de volta"}</h2>
        <p className="login-card__lead">
          {isRegister
            ? "Crie sua conta para começar uma nova aventura."
            : "Use seu nome de usuário ou e-mail para entrar."}
        </p>

        <form className="login-form" onSubmit={submit}>
          {isRegister ? (
            <>
              <label className="login-field">
                <span>Nome de usuário</span>
                <input
                  type="text"
                  name="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  autoFocus
                  required
                  minLength={3}
                  maxLength={32}
                  pattern="[A-Za-zÀ-ÖØ-öø-ÿ0-9_.-]+"
                  title="Use apenas letras, números, ponto, hífen ou sublinhado"
                  placeholder="aventureira"
                />
              </label>

              <label className="login-field">
                <span>E-mail</span>
                <input
                  type="email"
                  name="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="aventureira@exemplo.com"
                />
              </label>
            </>
          ) : (
            <label className="login-field">
              <span>Usuário ou e-mail</span>
              <input
                type="text"
                name="identifier"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                autoFocus
                required
                maxLength={254}
                placeholder="aventureira@exemplo.com"
              />
            </label>
          )}

          <label className="login-field">
            <span>Senha</span>
            <span className="login-password">
              <input
                type={showPassword ? "text" : "password"}
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={isRegister ? "new-password" : "current-password"}
                required
                minLength={isRegister ? 8 : 1}
                maxLength={128}
                placeholder={isRegister ? "No mínimo 8 caracteres" : "Digite sua senha"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </span>
          </label>

          {isRegister ? (
            <label className="login-field">
              <span>Confirme a senha</span>
              <input
                type={showPassword ? "text" : "password"}
                name="passwordConfirmation"
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                placeholder="Digite a senha novamente"
              />
            </label>
          ) : null}

          {problem ? (
            <p className="login-error" role="alert">
              {problem}
            </p>
          ) : null}

          <button className="button button--ink login-submit" type="submit" disabled={isSubmitting}>
            {submitLabel}
          </button>
        </form>

        <p className="login-card__foot">
          {isRegister ? "Já faz parte da campanha?" : "Ainda não tem uma conta?"}{" "}
          <button
            type="button"
            className="login-mode-link"
            onClick={() => changeMode(isRegister ? "login" : "register")}
          >
            {isRegister ? "Entrar" : "Cadastre-se"}
          </button>
        </p>
      </section>
    </main>
  );
}
