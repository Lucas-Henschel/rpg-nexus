import { useCallback, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastKind as Kind } from "./toast-context";

interface ToastState {
  id: number;
  kind: Kind;
  text: string;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((kind: Kind, text: string) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), kind, text });
    timer.current = window.setTimeout(() => setToast(null), kind === "error" ? 7000 : 3500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast toast--${toast.kind}`}>
            {toast.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}
