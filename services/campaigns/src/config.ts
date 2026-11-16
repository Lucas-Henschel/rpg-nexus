// Variáveis de ambiente do serviço, com os padrões do ambiente local
import { z } from "zod";

const count = (fallback: number) => z.coerce.number().int().min(0).default(fallback);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean)),

  AWS_ENDPOINT_URL: z.url().optional(),
  AWS_REGION: z.string().default("us-east-1"),

  TABLE_CAMPAIGNS: z.string().default("campaigns"),
  TABLE_MEMBERS: z.string().default("campaign_members"),
  TABLE_ACTIVITY: z.string().default("campaign_activity"),
  TABLE_OPERATIONS: z.string().default("campaign_operations"),
  TABLE_INBOX: z.string().default("campaign_inbox"),
  
  INBOX_TTL_DAYS: count(7),

  RABBITMQ_URL: z.string().default("amqp://dev:dev@localhost:5672/"),
  RABBITMQ_EXCHANGE: z.string().default("rpg.events"),
  RABBITMQ_QUEUE: z.string().default("campaigns.activity.v1"),
  RABBITMQ_RETRY_QUEUE: z.string().default("campaigns.activity.v1.retry"),
  RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(16),
  MAX_RETRIES: count(3),
  RETRY_BASE_DELAY_MS: count(1000),
  RETRY_MAX_DELAY_MS: count(15000),

  CONTRACTS_DIR: z.string().default("../../contracts"),

  // Tracing (OpenTelemetry). O endereço do Jaeger vem de OTEL_EXPORTER_OTLP_ENDPOINT, lido pelo exportador.
  TRACING_ENABLED: z.stringbool().default(false),
  SERVICE_NAME: z.string().default("campaigns"),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Variáveis de ambiente inválidas:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}
