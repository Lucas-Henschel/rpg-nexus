import { useCallback, useState } from "react";

const LEGACY_KEY = "rpg-nexus.campaign";
const KEY_PREFIX = "rpg-nexus.campaign.";
export const CAMPAIGN_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function keyFor(userId: string | undefined): string | null {
  return userId ? KEY_PREFIX + userId : null;
}

function read(userId: string | undefined): string {
  try {
    // Remove a preferência antiga, compartilhada entre todas as contas.
    window.localStorage.removeItem(LEGACY_KEY);
    const key = keyFor(userId);
    return key ? window.localStorage.getItem(key) ?? "" : "";
  } catch {
    return "";
  }
}

function write(userId: string | undefined, campaignId: string): void {
  const key = keyFor(userId);
  if (!key) return;

  try {
    if (campaignId) {
      window.localStorage.setItem(key, campaignId);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* armazenamento indisponível: vale só para esta visita */
  }
}

/** Campanha em uso, lembrada separadamente para cada usuário autenticado. */
export function useCampaign(userId: string | undefined): [string, (id: string) => void] {
  const [selection, setSelection] = useState(() => ({ userId, campaignId: read(userId) }));
  const campaignId = selection.userId === userId ? selection.campaignId : read(userId);
  const update = useCallback((id: string) => {
    setSelection({ userId, campaignId: id });
    write(userId, id);
  }, [userId]);

  return [campaignId, update];
}