/**
 * Modelos de ficha. São pontos de partida genéricos: depois de criar, tudo pode ser mudado na ficha.
 * Nenhum modelo aplica regras de um sistema comercial; eles só sugerem blocos e nomes.
 */
import type { BlockType, Sheet, SheetBlock, StatMap } from "../api";

export interface Template {
  id: string;
  name: string;
  summary: string;
  icon: "blank" | "sword" | "eye" | "planet" | "feather";
  attributes: StatMap;
  skills: StatMap;
  hpMax: number;
  maxItems: number;
  columns: SheetBlock[][];
}

export const BLOCK_TITLES: Record<BlockType, string> = {
  attributes: "Atributos",
  skills: "Perícias",
  hp: "Pontos de vida",
  backpack: "Mochila",
  text: "Anotações",
  counter: "Contador",
  dice: "Rolagens",
  list: "Lista",
};

/** Blocos ligados a um dado único da ficha: só cabe um de cada. */
export const SINGLETON_BLOCKS: BlockType[] = ["attributes", "skills", "hp", "backpack"];

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function block(
  type: BlockType,
  title = BLOCK_TITLES[type],
  data: Record<string, unknown> = {},
): SheetBlock {
  return { id: newBlockId(), type, title, data };
}

const counter = (title: string, current: number, max: number) =>
  block("counter", title, { current, max });
const rolls = (title: string, list: [string, string][]) =>
  block("dice", title, { rolls: list.map(([label, expr]) => ({ label, expr })) });
const list = (title: string, items: string[] = []) => block("list", title, { items });
const text = (title: string, body = "") => block("text", title, { body });

/** Ficha de quem foi criado antes dos blocos existirem, ou que voltou ao padrão. */
export function defaultSheet(): Sheet {
  // ids fixos: a ficha padrão precisa sair idêntica toda vez, para a tela saber se algo mudou
  const fixed = (type: BlockType): SheetBlock => ({
    id: type,
    type,
    title: BLOCK_TITLES[type],
    data: {},
  });

  return {
    template: null,
    header: {},
    columns: [
      [fixed("hp"), fixed("backpack")],
      [fixed("attributes"), fixed("skills")],
    ],
  };
}

/** A tela trabalha sempre com duas colunas; fichas salvas com outro formato são acomodadas nelas. */
export function normalizeSheet(sheet: Sheet | null): Sheet {
  if (!sheet) {
    return defaultSheet();
  }

  const [first = [], second = [], ...rest] = sheet.columns;

  return { template: sheet.template ?? null, header: sheet.header ?? {}, columns: [first, [...second, ...rest.flat()]] };
}

export const TEMPLATES: Template[] = [
  {
    id: "em-branco",
    name: "Em branco",
    summary: "Para o seu sistema próprio. A ficha começa vazia e você monta bloco por bloco.",
    icon: "blank",
    attributes: {},
    skills: {},
    hpMax: 10,
    maxItems: 10,
    columns: [[], []],
  },
  {
    id: "fantasia",
    name: "Fantasia clássica",
    summary: "Seis atributos, perícias de aventureiro, magias e ataques com d20.",
    icon: "sword",
    attributes: {
      forca: 10,
      destreza: 10,
      constituicao: 10,
      inteligencia: 10,
      sabedoria: 10,
      carisma: 10,
    },
    skills: { atletismo: 0, furtividade: 0, percepcao: 0, persuasao: 0, sobrevivencia: 0 },
    hpMax: 20,
    maxItems: 10,
    columns: [
      [block("hp"), counter("Pontos de magia", 4, 4), block("backpack"), list("Magias conhecidas")],
      [
        block("attributes"),
        block("skills"),
        rolls("Ataques", [
          ["Ataque com arma", "1d20+2"],
          ["Dano", "1d8+2"],
        ]),
        text("Anotações"),
      ],
    ],
  },
  {
    id: "investigacao",
    name: "Investigação e horror",
    summary: "Sanidade que acaba, pistas acumuladas e perícias de quem procura o que não devia.",
    icon: "eye",
    attributes: { forca: 1, agilidade: 1, intelecto: 2, presenca: 1, vigor: 1 },
    skills: {
      investigacao: 0,
      ocultismo: 0,
      percepcao: 0,
      medicina: 0,
      pontaria: 0,
      intimidacao: 0,
    },
    hpMax: 12,
    maxItems: 6,
    columns: [
      [block("hp"), counter("Sanidade", 12, 12), counter("Esforço", 3, 3), block("backpack")],
      [
        block("attributes"),
        block("skills"),
        list("Pistas"),
        rolls("Testes", [
          ["Teste comum", "1d20"],
          ["Dano de pistola", "1d10"],
        ]),
        text("Trauma e segredos"),
      ],
    ],
  },
  {
    id: "ficcao-cientifica",
    name: "Ficção científica",
    summary: "Tripulante de nave: escudo, munição, equipamento e perícias técnicas.",
    icon: "planet",
    attributes: { fisico: 10, reflexos: 10, tecnica: 10, intelecto: 10, frieza: 10 },
    skills: { pilotagem: 0, engenharia: 0, computadores: 0, armas_de_energia: 0, diplomacia: 0 },
    hpMax: 16,
    maxItems: 8,
    columns: [
      [block("hp"), counter("Escudo", 5, 5), counter("Munição", 12, 12), block("backpack")],
      [
        block("attributes"),
        block("skills"),
        list("Equipamento", ["Traje de vácuo", "Comunicador"]),
        rolls("Disparos", [
          ["Pistola de pulso", "1d20+1"],
          ["Dano", "2d6"],
        ]),
      ],
    ],
  },
  {
    id: "narrativo",
    name: "Regras leves",
    summary:
      "Três atributos e dados de seis lados. Para one-shots e mesas que preferem contar a história.",
    icon: "feather",
    attributes: { corpo: 2, mente: 2, espirito: 2 },
    skills: {},
    hpMax: 6,
    maxItems: 5,
    columns: [
      [block("hp"), counter("Pontos de destino", 3, 3), block("backpack")],
      [
        block("attributes"),
        rolls("Testes", [
          ["Ação arriscada", "2d6"],
          ["Com vantagem", "3d6"],
        ]),
        list("Laços e objetivos"),
        text("Conceito do personagem"),
      ],
    ],
  },
];

/** Cada personagem recebe cópias próprias dos blocos, com ids novos. */
export function sheetFromTemplate(template: Template): Sheet {
  return {
    template: template.id,
    header: {},
    columns: template.columns.map((column) =>
      column.map((b) => ({ ...structuredClone(b), id: newBlockId() })),
    ),
  };
}
