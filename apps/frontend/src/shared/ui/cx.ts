/** Junta classes CSS, pulando as condições falsas: cx("tile", inactive && "tile--inactive"). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
