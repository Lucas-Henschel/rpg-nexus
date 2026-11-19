import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3002),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://127.0.0.1:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),

  AWS_ENDPOINT_URL: z.url().optional(),
  AWS_REGION: z.string().default("us-east-1"),
  TABLE_USERS: z.string().default("identity_users"),
  TABLE_IDENTITIES: z.string().default("identity_unique_identifiers"),
  TABLE_SESSIONS: z.string().default("identity_sessions"),

  JWT_SECRET: z.string().min(32).default("dev-only-change-this-jwt-secret-32-characters"),
  JWT_ISSUER: z.string().min(1).default("rpg-nexus-identity"),
  JWT_AUDIENCE: z.string().min(1).default("rpg-nexus-services"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  PASSWORD_SCRYPT_N: z.coerce.number().int().min(2).default(16384),
  PASSWORD_SCRYPT_R: z.coerce.number().int().positive().default(8),
  PASSWORD_SCRYPT_P: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
