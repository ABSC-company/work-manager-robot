import "dotenv/config";
import { z } from "zod";
import path from "node:path";

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_SUPER_ADMIN_IDS: z.string().default(""),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  ENCRYPTION_KEY: z
    .string()
    .length(64, "ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)"),
  STORAGE_DIR: z.string().default("./storage"),
  UPLOADS_DIR: z.string().default("./storage/uploads"),
  REPORTS_DIR: z.string().default("./storage/reports"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Tashkent"),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("production"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    superAdminIds: env.TELEGRAM_SUPER_ADMIN_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  },
  database: {
    url: env.DATABASE_URL,
  },
  redis: {
    url: env.REDIS_URL,
  },
  anthropic: {
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL,
  },
  encryptionKey: env.ENCRYPTION_KEY,
  storage: {
    root: path.resolve(env.STORAGE_DIR),
    uploadsDir: path.resolve(env.UPLOADS_DIR),
    reportsDir: path.resolve(env.REPORTS_DIR),
  },
  defaultTimezone: env.DEFAULT_TIMEZONE,
  logLevel: env.LOG_LEVEL,
  isProduction: env.NODE_ENV === "production",
};

export type Config = typeof config;
