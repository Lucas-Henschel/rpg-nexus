import type { KeyboardEvent } from "react";

/**
 * onKeyDown que roda a ação no Enter. Os campos de "adicionar" ficam dentro de outros formulários,
 * então o Enter não pode chegar até eles e enviar tudo.
 */
export function onEnter(action: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    action();
  };
}
