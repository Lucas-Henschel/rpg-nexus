/** Endereços dos microsserviços. Cada um vem de uma variável VITE_* (ver .env.example). */
const env = import.meta.env;

function url(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, "");
}

export const services = {
  characters: { name: "Personagens", stack: "Python", owner: "P2", url: url(env.VITE_CHARACTERS_URL, "http://localhost:8000") },
  campaigns: { name: "Campanhas", stack: "TypeScript", owner: "P1", url: url(env.VITE_CAMPAIGNS_URL, "http://localhost:3001") },
  inventory: { name: "Inventário", stack: "Java", owner: "P3", url: url(env.VITE_INVENTORY_URL, "http://localhost:8080") },
  actions: { name: "Ações e histórico", stack: "TypeScript", owner: "P4", url: url(env.VITE_ACTIONS_URL, "http://localhost:3002") },
} as const;

export type ServiceKey = keyof typeof services;
