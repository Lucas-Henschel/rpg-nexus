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
