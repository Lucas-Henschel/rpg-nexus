import { useState } from "react";

const KEY = "rpg-nexus.campaign";
export const CAMPAIGN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function read(): string {
  try {
    return window.localStorage.getItem(KEY) || "c1";
  } catch {
    return "c1";
  }
}

/**
 * Campanha em uso. Enquanto o serviço de Campanhas (P1) não entra, a pessoa digita o código;
 * depois isto vira um seletor alimentado por GET /campaigns.
 */
export function useCampaign(): [string, (id: string) => void] {
  const [campaign, setCampaign] = useState(read);
  const update = (id: string) => {
    setCampaign(id);
    try {
      window.localStorage.setItem(KEY, id);
    } catch {
      /* armazenamento indisponível: vale só para esta visita */
    }
  };

  return [campaign, update];
}
