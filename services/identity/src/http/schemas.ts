import { z } from "zod";

export const RegisterBody = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[\p{L}\p{N}_.-]+$/u, "use apenas letras, números, ponto, hífen ou sublinhado"),
  email: z.email().max(254),
  password: z.string().min(8).max(128),
});

export const LoginBody = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

export const RefreshBody = z.object({ refreshToken: z.string().min(1).max(512) });

export const HistoryParams = z.object({
  campaignId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

export const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
