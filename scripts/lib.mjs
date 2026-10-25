// Спільне для скриптів: читання ключів і виклики REST-інтерфейсу Supabase без залежностей.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile() {
  const file = path.join(root, ".env.local");
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

const fileEnv = loadEnvFile();
export const SUPABASE_URL = (process.env.SUPABASE_URL || fileEnv.SUPABASE_URL || "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_KEY || fileEnv.SUPABASE_SERVICE_KEY || "";

export function requireEnv() {
  if (!SUPABASE_URL || !KEY) {
    console.error("Немає SUPABASE_URL або SUPABASE_SERVICE_KEY. Заповни файл .env.local (див. README).");
    process.exit(1);
  }
}

export async function rest(method, table, { query = "", body, prefer } = {}) {
  requireEnv();
  // Нові секретні ключі (sb_secret_...) не є JWT: їх передаємо лише в apikey
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  if (!KEY.startsWith("sb_")) headers.Authorization = `Bearer ${KEY}`;
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`${method} ${table}${query} -> ${res.status}\n${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : null;
}

export const upsert = (table, rows) =>
  rows.length
    ? rest("POST", table, { body: rows, prefer: "resolution=merge-duplicates,return=minimal" })
    : null;

export { root };
