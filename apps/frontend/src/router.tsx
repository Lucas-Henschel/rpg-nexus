/** Roteador pequeno sobre a History API — evita uma dependência só para sete rotas. */
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { navigate, PathContext } from "./navigation";

export function Router({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return <PathContext.Provider value={path}>{children}</PathContext.Provider>;
}

interface LinkProps {
  to: string;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page";
}

export function Link({ to, className, children, ...rest }: LinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={onClick} {...rest}>
      {children}
    </a>
  );
}
