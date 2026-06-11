import dotenv from "dotenv";
import fs from "fs";
import path from "path";
dotenv.config();
export function loadConfig() {
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
            }
            catch (e) {
                console.error(`Failed to parse config file at ${p}:`, e);
            }
        }
    }
    return {};
}
export const config = loadConfig();
export const PORT = config.port ?? parseInt(process.env.PORT ?? "8081", 10);
export const HOST = config.host ?? (process.env.HOST || "0.0.0.0");
export const GEMINI_BL = config.gemini_bl ?? (process.env.GEMINI_BL || "boq_assistant-bard-web-server_20260525.09_p0");
export const AUTH_USER = config.auth_user !== undefined ? (config.auth_user ?? "") : (process.env.AUTH_USER || "");
export const RETRY_ATTEMPTS = config.retry_attempts ?? parseInt(process.env.RETRY_ATTEMPTS ?? "3", 10);
export const RETRY_DELAY_SEC = config.retry_delay_sec ?? parseInt(process.env.RETRY_DELAY_SEC ?? "2", 10);
