import { createContext, useContext } from "react";

export type ToastKind = "ok" | "error";

export const ToastContext = createContext<(kind: ToastKind, text: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}
