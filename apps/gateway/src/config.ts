import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { z } from "zod";

dotenv.config();

export function loadConfigFile(): any {
  const paths = [
    path.resolve(process.cwd(), "config.json"),
    path.resolve(process.cwd(), "../config.json"),
    path.resolve(process.cwd(), "../../config.json"),
    path.resolve(process.cwd(), "apps/gateway/config.json")
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, "utf-8");
        return JSON.parse(content);
      } catch (e) {
        console.error(`Failed to parse config file at ${p}:`, e);
      }
    }
  }
  return {};
}

const fileConfig = loadConfigFile();

// Define validation schema for configuration & environment variables
const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8081),
  HOST: z.string().default("0.0.0.0"),
  GEMINI_BL: z.string().default("boq_assistant-bard-web-server_20260525.09_p0"),
  AUTH_USER: z.string().default(""),
  RETRY_ATTEMPTS: z.coerce.number().int().nonnegative().default(3),
  RETRY_DELAY_SEC: z.coerce.number().int().nonnegative().default(2),
  SUPABASE_URL: z.string().optional().default(""),
  SUPABASE_KEY: z.string().optional().default(""),
  REDIS_URL: z.string().optional().default(""),
  LOG_LEVEL: z.string().default("info"),
  DEFAULT_RATE_LIMIT_RPM: z.coerce.number().int().nonnegative().default(15),
  ADMIN_API_KEY: z.string().default("sk-personal-gw"),
  GEMINI_COOKIE: z.string().optional().default(""),
  COOKIE_FILE: z.string().nullable().optional(),
  API_KEYS: z.array(z.string()).optional()
});

const mergedConfig = {
  PORT: fileConfig.port ?? process.env.PORT,
  HOST: fileConfig.host ?? process.env.HOST,
  GEMINI_BL: fileConfig.gemini_bl ?? process.env.GEMINI_BL,
  AUTH_USER: (fileConfig.auth_user !== undefined ? fileConfig.auth_user : process.env.AUTH_USER) ?? "",
  RETRY_ATTEMPTS: fileConfig.retry_attempts ?? process.env.RETRY_ATTEMPTS,
  RETRY_DELAY_SEC: fileConfig.retry_delay_sec ?? process.env.RETRY_DELAY_SEC,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_KEY: process.env.SUPABASE_KEY,
  REDIS_URL: process.env.REDIS_URL,
  LOG_LEVEL: process.env.LOG_LEVEL,
  DEFAULT_RATE_LIMIT_RPM: process.env.DEFAULT_RATE_LIMIT_RPM,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY,
  GEMINI_COOKIE: process.env.GEMINI_COOKIE,
  COOKIE_FILE: fileConfig.cookie_file,
  API_KEYS: fileConfig.api_keys
};

const parseResult = configSchema.safeParse(mergedConfig);
if (!parseResult.success) {
  console.error("❌ Configuration validation failed:");
  console.error(JSON.stringify(parseResult.error.format(), null, 2));
  process.exit(1);
}

export const config = parseResult.data;

export const PORT = config.PORT;
export const HOST = config.HOST;
export const GEMINI_BL = config.GEMINI_BL;
export const AUTH_USER = config.AUTH_USER;
export const RETRY_ATTEMPTS = config.RETRY_ATTEMPTS;
export const RETRY_DELAY_SEC = config.RETRY_DELAY_SEC;
export const SUPABASE_URL = config.SUPABASE_URL;
export const SUPABASE_KEY = config.SUPABASE_KEY;
export const REDIS_URL = config.REDIS_URL;
export const LOG_LEVEL = config.LOG_LEVEL;
export const DEFAULT_RATE_LIMIT_RPM = config.DEFAULT_RATE_LIMIT_RPM;
export const ADMIN_API_KEY = config.ADMIN_API_KEY;
export const GEMINI_COOKIE = config.GEMINI_COOKIE;
export const COOKIE_FILE = config.COOKIE_FILE;
export const API_KEYS = config.API_KEYS;
