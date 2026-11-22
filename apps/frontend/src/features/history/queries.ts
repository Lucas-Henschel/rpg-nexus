import { useQuery } from "@tanstack/react-query";
import { listHistory } from "./api";

export function useHistory(campaignId: string) {
  return useQuery({
    queryKey: ["history", campaignId],
    queryFn: () => listHistory(campaignId),
    enabled: Boolean(campaignId),
    refetchInterval: 5_000,
  });
}
