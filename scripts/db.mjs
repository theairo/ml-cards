// Керування базою з терміналу (ключ service_role береться з .env.local, у чат не потрапляє).
//
//   node scripts/db.mjs seed [data/seed.json]      завантажити початкові теми, картки, лаби
//   node scripts/db.mjs tree                       дерево тем з кількістю карток
//   node scripts/db.mjs inbox                      нерозподілені картки (додані в застосунку)
//   node scripts/db.mjs assign <card_id> node=<id> type=A2 depth=1 requires=a,b position=3
//   node scripts/db.mjs apply <file.json>          upsert { nodes, cards, labs } (повні рядки)
//   node scripts/db.mjs delete-card <card_id>
import fs from "node:fs";
import path from "node:path";
import { rest, upsert, root } from "./lib.mjs";

const [cmd, ...args] = process.argv.slice(2);

// Вузли вставляємо рівень за рівнем: від кореня до листків (зовнішній ключ на батька)
async function upsertNodes(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const level = (n) => (n.parent_id && byId.has(n.parent_id) ? 1 + level(byId.get(n.parent_id)) : 0);
  const levels = new Map();
  nodes.forEach((n) => levels.set(level(n), [...(levels.get(level(n)) || []), n]));
  for (const l of [...levels.keys()].sort((a, b) => a - b)) await upsert("nodes", levels.get(l));
}

async function applyData({ nodes = [], cards = [], labs = [] }) {
  await upsertNodes(nodes);
  await upsert("labs", labs);
  await upsert("cards", cards);
  console.log(`nodes ${nodes.length}, cards ${cards.length}, labs ${labs.length}`);
}

async function main() {
  if (cmd === "seed") {
    const file = args[0] || path.join(root, "data", "seed.json");
    await applyData(JSON.parse(fs.readFileSync(file, "utf8")));
  } else if (cmd === "apply") {
    await applyData(JSON.parse(fs.readFileSync(args[0], "utf8")));
  } else if (cmd === "tree") {
    const nodes = await rest("GET", "nodes", { query: "?select=id,parent_id,title,tier,position&order=position" });
    const cards = await rest("GET", "cards", { query: "?select=id,node_id,type,depth" });
    const count = {};
    cards.forEach((c) => { count[c.node_id] = (count[c.node_id] || 0) + 1; });
    const kids = {};
    nodes.forEach((n) => { (kids[n.parent_id] = kids[n.parent_id] || []).push(n); });
    const print = (n, pad) => {
      console.log(`${pad}${n.id}  "${n.title}" [${n.tier}]${count[n.id] ? "  cards: " + count[n.id] : ""}`);
      (kids[n.id] || []).forEach((k) => print(k, pad + "  "));
    };
    (kids[null] || kids["null"] || []).forEach((n) => print(n, ""));
    console.log(`\nнерозподілених карток: ${count[null] || count["null"] || 0}`);
  } else if (cmd === "inbox") {
    const rows = await rest("GET", "cards", { query: "?node_id=is.null&select=id,question,answer,created_at&order=created_at" });
    if (!rows.length) console.log("Нерозподілених карток немає.");
    rows.forEach((c) => console.log(`${c.id}\n  Q: ${c.question}\n  A: ${c.answer}\n`));
  } else if (cmd === "assign") {
    const [id, ...pairs] = args;
    const patch = {};
    for (const p of pairs) {
      const [k, ...rest_] = p.split("=");
      const v = rest_.join("=");
      if (k === "depth" || k === "position") patch[k] = Number(v);
      else if (k === "requires") patch[k] = v ? v.split(",") : [];
      else if (k === "node") patch.node_id = v === "null" ? null : v;
      else patch[k] = v;
    }
    await rest("PATCH", `cards?id=eq.${encodeURIComponent(id)}`, { body: patch, prefer: "return=minimal" });
    console.log("updated", id, patch);
  } else if (cmd === "delete-card") {
    await rest("DELETE", `cards?id=eq.${encodeURIComponent(args[0])}`, { prefer: "return=minimal" });
    console.log("deleted", args[0]);
  } else {
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 9).join("\n"));
  }
}
main();
