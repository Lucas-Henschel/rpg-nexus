/**
 * O serviço guarda chaves sem acento (ex.: "forca"). Aqui ficam a conversão do que a pessoa digita
 * para a chave e o caminho de volta para um rótulo legível.
 */
const KNOWN: Record<string, string> = {
  forca: "Força",
  destreza: "Destreza",
  constituicao: "Constituição",
  inteligencia: "Inteligência",
  sabedoria: "Sabedoria",
  carisma: "Carisma",
  percepcao: "Percepção",
  persuasao: "Persuasão",
  intuicao: "Intuição",
  intimidacao: "Intimidação",
  investigacao: "Investigação",
  religiao: "Religião",
  historia: "História",
  sobrevivencia: "Sobrevivência",
  enganacao: "Enganação",
  atuacao: "Atuação",
  prestidigitacao: "Prestidigitação",
};

export const CLASSIC_ATTRIBUTES = [
  "forca",
  "destreza",
  "constituicao",
  "inteligencia",
  "sabedoria",
  "carisma",
];

export function toKey(typed: string): string {
  return typed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 32);
}

export function toLabel(key: string): string {
  if (KNOWN[key]) {
    return KNOWN[key];
  }
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
