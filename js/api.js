// Шар доступу до даних. Два варіанти з однаковим інтерфейсом:
//   supabaseApi: справжня база (за замовчуванням),
//   mockApi: локальна імітація для розробки, вмикається лише на localhost через ?mock=1.
import { CONFIG } from "../config.js";

const PAGE = 1000;

export async function createApi() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  if (local && new URLSearchParams(location.search).has("mock")) return mockApi();
  return supabaseApi();
}

async function supabaseApi() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  const sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const must = ({ data, error }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  // Supabase віддає не більше 1000 рядків за запит, тому читаємо сторінками
  async function readAll(table, order) {
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const part = must(await sb.from(table).select("*").order(order).range(from, from + PAGE - 1));
      rows.push(...part);
      if (part.length < PAGE) return rows;
    }
  }

  return {
    mode: "supabase",
    async hasSession() {
      const { data } = await sb.auth.getSession();
      return !!data.session;
    },
    async signIn(password) {
      const { error } = await sb.auth.signInWithPassword({ email: CONFIG.OWNER_EMAIL, password });
      if (error) throw new Error(error.message);
    },
    async signOut() {
      await sb.auth.signOut();
    },
    async loadAll() {
      const [nodes, cards, labs, progress, activity] = await Promise.all([
        readAll("nodes", "position"),
        readAll("cards", "position"),
        readAll("labs", "created_at"),
        readAll("progress", "card_id"),
        readAll("activity", "day"),
      ]);
      return { nodes, cards, labs, progress, activity };
    },
    async saveProgress(rows) {
      if (!rows.length) return;
      must(await sb.from("progress").upsert(rows, { onConflict: "card_id" }));
    },
    async saveActivity(rows) {
      if (!rows.length) return;
      must(await sb.from("activity").upsert(rows, { onConflict: "day" }));
    },
    async addCard(card) {
      return must(await sb.from("cards").insert(card).select().single());
    },
    async resetProgress() {
      must(await sb.from("progress").delete().neq("card_id", ""));
      must(await sb.from("activity").delete().gte("day", "1900-01-01"));
    },
  };
}

// Локальна імітація: дані беруться з data/seed.json (лише для розробки, у публічний репозиторій не входить)
async function mockApi() {
  const seed = await (await fetch("data/seed.json")).json();
  const KEY = "mlcards_mock_v1";
  let db = JSON.parse(localStorage.getItem(KEY) || "null") || { progress: {}, activity: {}, extra: [] };
  const persist = () => localStorage.setItem(KEY, JSON.stringify(db));
  return {
    mode: "mock",
    async hasSession() {
      return sessionStorage.getItem("mock_in") === "1";
    },
    async signIn(password) {
      if (password !== "test") throw new Error("Invalid login credentials");
      sessionStorage.setItem("mock_in", "1");
    },
    async signOut() {
      sessionStorage.removeItem("mock_in");
    },
    async loadAll() {
      return {
        nodes: seed.nodes,
        cards: [...seed.cards, ...db.extra],
        labs: seed.labs,
        progress: Object.values(db.progress),
        activity: Object.values(db.activity),
      };
    },
    async saveProgress(rows) {
      rows.forEach((r) => { db.progress[r.card_id] = r; });
      persist();
    },
    async saveActivity(rows) {
      rows.forEach((r) => { db.activity[r.day] = r; });
      persist();
    },
    async addCard(card) {
      const row = { position: 0, depth: 1, requires: [], node_id: null, type: null, ...card };
      db.extra.push(row);
      persist();
      return row;
    },
    async resetProgress() {
      db.progress = {};
      db.activity = {};
      persist();
    },
  };
}
