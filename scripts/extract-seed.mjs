// Одноразово: витягує картки й таксономію зі старої сторінки ml_cards.html у data/seed.json.
// Файл data/ у .gitignore, тексти карток у публічний репозиторій не потрапляють.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { root } from "./lib.mjs";

const src = process.argv[2] || path.resolve(root, "..", "methodology DS", "1", "ml_cards.html");
const html = fs.readFileSync(src, "utf8");

function slice(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  if (a < 0 || b < 0) throw new Error("marker not found: " + startMarker);
  return html.slice(a, b);
}

const ctx = vm.createContext({});
vm.runInContext(slice("var POOL = [", "// ===== Стан і збереження"), ctx);
vm.runInContext(slice("var DEPTH = {", "// Лаби, в яких"), ctx);
vm.runInContext(slice("var REQ = {", "function rank"), ctx);
const { POOL, DEPTH, REQ } = ctx;

// Таксономія з явними id (групи) і посиланнями на листові вузли (id з POOL)
const T = {
  id: "ml", title: "Machine Learning", children: [
    { id: "supervised", title: "Навчання з учителем", children: [
      { id: "classification", title: "Класифікація", children: ["lr", "rf"] },
      { id: "regression", title: "Регресія", leaf: true, tier: "core" },
    ]},
    { id: "unsupervised", title: "Навчання без вчителя", children: [
      { id: "clustering", title: "Кластеризація", leaf: true, tier: "core" },
    ]},
    { id: "data_prep", title: "Підготовка даних", children: [
      { id: "split_leak", title: "Розбиття та витік", children: ["split", "leak"] },
      { id: "numeric", title: "Числові ознаки", children: ["yj", "bc"] },
      { id: "categorical", title: "Категоріальні ознаки", children: ["te", "woe"] },
      { id: "imbalance", title: "Дисбаланс класів", children: ["imb", "cw", "smote", "adasyn", "tomek"] },
      { id: "selection", title: "Селекція ознак", children: ["seltypes", "boruta"] },
    ]},
    { id: "evaluation", title: "Оцінювання і пайплайни", children: ["metrics", "pipe"] },
  ],
};

const poolById = {};
POOL.forEach((cat) => cat.nodes.forEach((n) => { poolById[n.id] = n; }));

const nodes = [];
const cards = [];
const leafWithCards = [];

function walk(def, parentId, position) {
  if (typeof def === "string") {
    const n = poolById[def];
    nodes.push({ id: n.id, parent_id: parentId, title: n.title, tier: n.tier, position });
    leafWithCards.push(n.id);
    n.cards.forEach((c, i) => {
      cards.push({
        id: `${n.id}.${i}`,
        node_id: n.id,
        type: c.t,
        depth: (DEPTH[n.id] || [])[i] || 1,
        question: c.q,
        answer: c.a,
        requires: REQ[`${n.id}.${i}`] || [],
        position: i,
      });
    });
    return;
  }
  nodes.push({ id: def.id, parent_id: parentId, title: def.title, tier: def.tier || "mid", position });
  (def.children || []).forEach((k, i) => walk(k, def.id, i));
}
walk(T, null, 0);

const labs = [{
  id: "practicum1",
  title: "Практикум 1: Feature Engineering, балансування, Pipeline",
  node_ids: leafWithCards,
}];

const out = path.join(root, "data", "seed.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ nodes, cards, labs }, null, 1));
console.log(`nodes: ${nodes.length}, cards: ${cards.length}, labs: ${labs.length} -> ${out}`);
