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
  TABLE_LOGIN_ATTEMPTS: z.string().default("identity_login_attempts"),
  TABLE_HISTORY: z.string().default("action_history"),
  TABLE_HISTORY_INBOX: z.string().default("action_history_inbox"),
  TABLE_HISTORY_MEMBERSHIPS: z.string().default("action_history_memberships"),
  TABLE_AUDIT: z.string().default("identity_audit"),
  TABLE_VALIDATION_INBOX: z.string().default("action_validation_inbox"),
  TABLE_VALIDATION_OUTBOX: z.string().default("action_validation_outbox"),

  HISTORY_INBOX_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  RABBITMQ_URL: z.string().default("amqp://dev:dev@localhost:5672/"),
  RABBITMQ_QUEUE: z.string().default("actions.history.v1"),
  RABBITMQ_RETRY_QUEUE: z.string().default("actions.history.v1.retry"),
  RABBITMQ_EXCHANGE: z.string().default("rpg.events"),
  VALIDATION_QUEUE: z.string().default("actions.validation-requested.v1"),
  VALIDATION_RETRY_QUEUE: z.string().default("actions.validation-requested.v1.retry"),
  VALIDATION_MIN_DELAY_MS: z.coerce.number().int().min(0).default(100),
  VALIDATION_MAX_DELAY_MS: z.coerce.number().int().min(0).default(500),
  VALIDATION_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
  VALIDATION_OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(16),
  MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  RETRY_BASE_DELAY_MS: z.coerce.number().int().min(0).default(1000),
  RETRY_MAX_DELAY_MS: z.coerce.number().int().min(0).default(15000),
  CONTRACTS_DIR: z.string().default("../../contracts"),

  JWT_SECRET: z.string().min(32).default("dev-only-change-this-jwt-secret-32-characters"),
  JWT_ISSUER: z.string().min(1).default("rpg-nexus-identity"),
  JWT_AUDIENCE: z.string().min(1).default("rpg-nexus-services"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604800),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(2).default(5),
  LOGIN_ATTEMPT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  LOGIN_LOCK_SECONDS: z.coerce.number().int().positive().default(900),

  PASSWORD_SCRYPT_N: z.coerce.number().int().min(2).default(16384),
  PASSWORD_SCRYPT_R: z.coerce.number().int().positive().default(8),
  PASSWORD_SCRYPT_P: z.coerce.number().int().positive().default(1),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.superRefine((value, context) => {
    if (value.VALIDATION_MAX_DELAY_MS < value.VALIDATION_MIN_DELAY_MS) {
      context.addIssue({ code: "custom", path: ["VALIDATION_MAX_DELAY_MS"], message: "deve ser maior ou igual a VALIDATION_MIN_DELAY_MS" });
    }
  }).safeParse(source);

  if (!result.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
