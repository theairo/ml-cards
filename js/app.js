import { createApi } from "./api.js?v=6";
import { CONFIG } from "../config.js";

const DAY = 86400000;
const LOGO_PLACEHOLDER = "YOUR-PROJECT";

let api;
const S = {
  root: null,
  nodes: {},
  cards: [],
  progress: {},     // card_id -> { iv, reps, due(ms), first('YYYY-MM-DD' | null) }
  settings: { new_per_day: 20, extra: null },
  activity: {},     // 'YYYY-MM-DD' -> count
  labs: [],
  pending: {},      // зміни, які ще не збережено в базі
  pendingAct: {},
  syncError: false,
};

let view = "loading";     // loading | login | home | review | summary
let scope = null;
let queue = [];
let current = null;
let showAns = false;
let session = null;
let selNode = null;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ===== Побудова дерева з рядків бази =====
function buildModel(data) {
  S.nodes = {};
  data.nodes.forEach((n) => { S.nodes[n.id] = { ...n, kids: [], cards: [], parent: null }; });
  S.root = null;
  [...data.nodes].sort((a, b) => a.position - b.position).forEach((n) => {
    const node = S.nodes[n.id];
    if (n.parent_id && S.nodes[n.parent_id]) {
      node.parent = S.nodes[n.parent_id];
      node.parent.kids.push(node);
    } else {
      S.root = node;
    }
  });
  const setDepth = (n, d) => { n.depth = d; n.kids.forEach((k) => setDepth(k, d + 1)); };
  setDepth(S.root, 0);

  const inbox = { id: "_inbox", title: "Нерозподілені", tier: "core", kids: [], cards: [], parent: S.root, depth: 1, virtual: true };
  S.nodes._inbox = inbox;

  const sorted = [...data.cards].sort((a, b) =>
    (a.position - b.position) || String(a.created_at || "").localeCompare(String(b.created_at || "")));
  S.cards = [];
  sorted.forEach((row) => addCardToModel(row));

  S.labs = data.labs;
  S.progress = {};
  data.progress.forEach((p) => {
    S.progress[p.card_id] = { iv: p.iv, reps: p.reps, due: new Date(p.due).getTime(), first: p.first_seen ? String(p.first_seen).slice(0, 10) : null };
  });
  S.settings = { new_per_day: 20, extra: null };
  (data.settings || []).forEach((r) => {
    if (r.key === "new_per_day") S.settings.new_per_day = Number(r.value);
    if (r.key === "extra_new") S.settings.extra = r.value;
  });
  S.activity = {};
  data.activity.forEach((a) => { S.activity[String(a.day).slice(0, 10)] = a.count; });
  refreshInbox();
}

function addCardToModel(row) {
  const node = S.nodes[row.node_id] || S.nodes._inbox;
  const c = { id: row.id, t: row.type, d: row.depth || 1, requires: row.requires || [], q: row.question, a: row.answer, node };
  node.cards.push(c);
  S.cards.push(c);
  return c;
}

function refreshInbox() {
  const inbox = S.nodes._inbox;
  const present = S.root.kids.includes(inbox);
  if (inbox.cards.length && !present) S.root.kids.push(inbox);
  if (!inbox.cards.length && present) S.root.kids = S.root.kids.filter((k) => k !== inbox);
}

// ===== Правила карток =====
const cardsOf = (n) => n.kids.reduce((acc, k) => acc.concat(cardsOf(k)), n.cards.slice());
const isActive = (c) => c.d <= encounters(c.node);
const activeOf = (n) => cardsOf(n).filter(isActive);
const st = (c) => S.progress[c.id] || null;
const interval = (c) => (st(c) ? st(c).iv : 0);
const rank = (c) => (c.t ? parseInt(c.t.slice(1), 10) : 0);
// Картка розблоковує наступні, лише коли її засвоєно (оцінка не «Знову»); «Знову» дає інтервал 0
const learned = (c) => !!st(c) && st(c).iv > 0;

function encounters(n) {
  let k = 0;
  S.labs.forEach((l) => { if (l.node_ids.includes(n.id)) k++; });
  return Math.max(k, 1);
}

// Картка вищого типу відкривається після засвоєння нижчих карток теми; згадана тема має бути засвоєна (A1)
function isAvail(c) {
  if (st(c)) return true;
  if (!isActive(c)) return false;
  if (rank(c) > 0) {
    for (const o of c.node.cards) {
      if (o !== c && isActive(o) && rank(o) > 0 && rank(o) < rank(c) && !learned(o)) return false;
    }
  }
  for (const id of c.requires) {
    const first = S.nodes[id] && S.nodes[id].cards[0];
    if (first && !learned(first)) return false;
  }
  return true;
}

function isDue(c) {
  const s = st(c);
  if (s) return s.due <= Date.now();
  return isAvail(c);
}

function mastery(cards) {
  if (!cards.length) return 0;
  let sum = 0;
  cards.forEach((c) => { sum += Math.min(interval(c) / 21, 1); });
  return sum / cards.length;
}

function level(cards) {
  if (!cards.some((c) => st(c))) return 0;
  const m = mastery(cards);
  if (m < 0.15) return 1;
  if (m < 0.45) return 2;
  if (m < 0.8) return 3;
  return 4;
}

const colorVar = (l) => "var(--m" + l + ")";

// ===== Інтервали =====
function calcIv(s, grade) {
  if (grade === 0) return 0;
  if (grade === 1) return Math.max(1, s.iv * 1.2);
  if (grade === 2) return s.iv < 1 ? 1 : (s.iv < 3 ? 3 : s.iv * 2.5);
  if (grade === 3) return s.iv < 1 ? 4 : s.iv * 3.5;
  return 30;
}
function fmt(iv) {
  if (iv === 0) return "5 хв";
  if (iv < 30) return Math.round(iv) + " д";
  return Math.round(iv / 30) + " міс";
}
// Інтервал після оцінки. Якщо картку повторюють раніше строку, ріст рахується від фактично минулого часу
// і інтервал не скорочується: ранній перегляд дає менший ефект, ніж вчасний.
function nextIv(c, grade) {
  if (grade === 4) return 30;
  const s = st(c) || { iv: 0, reps: 0 };
  const early = grade > 0 && !!s.due && s.iv > 0 && Date.now() < s.due;
  let base = s.iv;
  if (early) {
    const elapsed = (Date.now() - (s.due - s.iv * DAY)) / DAY;
    base = Math.max(0, Math.min(s.iv, elapsed));
  }
  const iv = calcIv({ iv: base }, grade);
  return early ? Math.max(iv, s.iv) : iv;
}
const hint = (c, grade) => fmt(nextIv(c, grade));

// ===== Денний ліміт нових карток =====
function extraToday() {
  const e = S.settings.extra;
  return e && e.day === dayKey(0) ? e.n : 0;
}
const limitToday = () => S.settings.new_per_day + extraToday();
const newToday = () => Object.values(S.progress).filter((p) => p.first === dayKey(0)).length;
const remainingNew = () => Math.max(0, limitToday() - newToday());

// ===== Серія днів =====
const p2 = (n) => (n < 10 ? "0" : "") + n;
function dayKey(offset) {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
}
function streak() {
  const off = S.activity[dayKey(0)] ? 0 : 1;
  let k = 0;
  while (S.activity[dayKey(off + k)]) k++;
  return k;
}
const todayCount = () => S.activity[dayKey(0)] || 0;

// ===== Збереження в базі =====
async function flush() {
  const rows = Object.values(S.pending);
  const acts = Object.values(S.pendingAct);
  if (!rows.length && !acts.length) return;
  try {
    await api.saveProgress(rows);
    await api.saveActivity(acts);
    S.pending = {};
    S.pendingAct = {};
    S.syncError = false;
  } catch (e) {
    S.syncError = true;
    console.error(e);
  }
  renderChips();
}

function rate(c, grade) {
  const s = st(c) || { iv: 0, reps: 0 };
  const iv = nextIv(c, grade);
  const due = Date.now() + (iv === 0 ? 5 * 60000 : iv * DAY);
  const first = st(c) ? (s.first || null) : dayKey(0);   // старі картки без дати не вважаються новими
  S.progress[c.id] = { iv, reps: s.reps + 1, due, first };
  S.pending[c.id] = { card_id: c.id, iv, reps: s.reps + 1, due: new Date(due).toISOString(), first_seen: first };
  const day = dayKey(0);
  S.activity[day] = todayCount() + 1;
  S.pendingAct[day] = { day, count: S.activity[day] };
  flush();
}

// ===== Повторення =====
const scopeCards = () => activeOf(scope);

// Повторення, що вже чекають, і нові картки в межах денного ліміту (порядок дерева зберігається)
function buildQueue(cards) {
  const keep = new Set();
  cards.forEach((c) => { if (st(c) && st(c).due <= Date.now()) keep.add(c); });
  let budget = remainingNew();
  for (const c of cards) {
    if (!st(c) && isAvail(c) && budget > 0) { keep.add(c); budget--; }
  }
  return cards.filter((c) => keep.has(c));
}

function startReview() {
  queue = buildQueue(scopeCards());
  if (!queue.length) return;
  session = { total: queue.length, done: 0, tries: 0, good: 0, ahead: false };
  view = "review";
  nextCard();
}

// Повторення наперед: картки, яким ще не час (до 20 найближчих)
const aheadCards = () => scopeCards().filter((c) => st(c) && st(c).due > Date.now()).sort((a, b) => st(a).due - st(b).due);
function startAhead() {
  queue = aheadCards().slice(0, 20);
  if (!queue.length) return;
  session = { total: queue.length, done: 0, tries: 0, good: 0, ahead: true };
  view = "review";
  nextCard();
}

async function moreNew() {
  S.settings.extra = { day: dayKey(0), n: extraToday() + 10 };
  try { await api.saveSetting("extra_new", S.settings.extra); } catch (e) { toast("Не вдалось зберегти: " + e.message); }
  render();
}

async function setLimit() {
  const v = prompt("Нових карток на день:", String(S.settings.new_per_day));
  if (v === null) return;
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0 || n > 500) { toast("Введи число від 0 до 500"); return; }
  S.settings.new_per_day = n;
  try { await api.saveSetting("new_per_day", n); } catch (e) { toast("Не вдалось зберегти: " + e.message); }
  render();
}

function nextCard() {
  current = queue.shift() || null;
  showAns = false;
  if (!current) view = "summary";
  render();
}

function grade(g) {
  if (!current || !showAns) return;
  const c = current;
  rate(c, g);
  session.tries++;
  if (g >= 2) session.good++;
  if (g === 0) queue.push(c); else session.done++;
  if (!session.ahead) {
    // нові картки, відкриті щойно засвоєною, додаємо в чергу в межах ліміту
    const inQ = {};
    queue.forEach((x) => { inQ[x.id] = 1; });
    let allowed = Math.max(0, remainingNew() - queue.filter((x) => !st(x)).length);
    const fresh = [];
    for (const x of scopeCards()) {
      if (allowed > 0 && !st(x) && isAvail(x) && !inQ[x.id]) { fresh.push(x); allowed--; }
    }
    queue = fresh.concat(queue);
    session.total += fresh.length;
  }
  nextCard();
}

// ===== Мапа =====
const colX = (d) => (d === 0 ? 8 : 150 + (d - 1) * 190);
const boxW = (d) => (d === 0 ? 124 : 164);
const ROW = 30;

function layout(n, ctx) {
  if (!n.kids.length) {
    n.y = ctx.y;
    ctx.y += ROW;
  } else {
    n.kids.forEach((k) => layout(k, ctx));
    n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2;
  }
  if (n.depth === 1) ctx.y += 12;
}

function maxDepth(n) {
  let d = n.depth;
  n.kids.forEach((k) => { d = Math.max(d, maxDepth(k)); });
  return d;
}

function drawNode(n, parts) {
  const x = colX(n.depth);
  const cards = cardsOf(n);
  const act = activeOf(n);
  const l = level(act);
  const sel = selNode === n ? " sel" : "";
  const empty = cards.length === 0;
  if (n.parent) {
    const p = n.parent;
    const px = colX(p.depth) + boxW(p.depth);
    parts.push('<path d="M' + px + " " + p.y + " C" + (px + 24) + " " + p.y + " " + (x - 24) + " " + n.y + " " + x + " " + n.y + '" fill="none" stroke="var(--line)" stroke-width="2" stroke-linecap="round"/>');
  }
  if (n.kids.length) {
    const w = boxW(n.depth);
    const dash = empty ? ' stroke-dasharray="4 3"' : "";
    const fill = empty ? "var(--bg)" : colorVar(l);
    const tc = (empty || l === 0) ? "var(--text)" : "#111";
    parts.push('<g class="node' + sel + '" data-id="' + esc(n.id) + '"><rect x="' + x + '" y="' + (n.y - 13) + '" width="' + w + '" height="26" rx="12" fill="' + fill + '" stroke="var(--line)"' + dash + '/><text x="' + (x + w / 2) + '" y="' + (n.y + 4) + '" text-anchor="middle" style="fill:' + tc + '">' + esc(n.title) + "</text></g>");
  } else {
    const r = n.tier === "core" ? 8 : (n.tier === "mid" ? 6 : 4.5);
    const cf = empty ? "var(--bg)" : colorVar(l);
    const cd = empty ? ' stroke-dasharray="3 2"' : "";
    const label = esc(n.title) + (empty ? "" : " (" + act.length + ")");
    parts.push('<g class="node' + sel + '" data-id="' + esc(n.id) + '"><circle cx="' + (x + 8) + '" cy="' + n.y + '" r="' + r + '" fill="' + cf + '" stroke="var(--line)"' + cd + '/><text x="' + (x + 24) + '" y="' + (n.y + 4) + '">' + label + "</text></g>");
  }
  n.kids.forEach((k) => drawNode(k, parts));
}

function renderMap() {
  const ctx = { y: 24 };
  layout(S.root, ctx);
  const H = ctx.y;
  const W = colX(maxDepth(S.root)) + 24 + 210;
  const parts = [];
  drawNode(S.root, parts);
  $("mapScroll").innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Мапа тем">' + parts.join("") + "</svg>";
  renderSheet();
}

function renderLegend() {
  const names = ["не бачив", "слабо", "так собі", "добре", "міцно"];
  $("legend").innerHTML = names.map((n, i) => '<span><i style="background:var(--m' + i + ')"></i>' + n + "</span>").join("") +
    "<span>Пунктир: карток ще немає</span><span>Розмір кружка: важливість теми</span>";
}

function pathOf(n) {
  const parts = [];
  while (n) { parts.unshift(n.title); n = n.parent; }
  return parts.join(" > ");
}

function renderSheet() {
  const el = $("sheet");
  if (!selNode) { el.hidden = true; return; }
  const cards = cardsOf(selNode);
  const active = activeOf(selNode);
  const due = active.filter(isDue).length;
  let h = "<h2>" + esc(selNode.title) + "</h2>";
  h += '<div class="muted">' + esc(pathOf(selNode)) + "</div>";
  h += '<div class="muted">Доступно ' + active.length + " з " + cards.length + ", до повторення " + due + "</div>";
  if (!cards.length) h += '<p class="muted">Карток ще немає. Вони з\'являться, коли ця тема зустрінеться в лабі.</p>';
  h += '<div class="row"><button class="btn primary" id="sheetGo"' + (due ? "" : " disabled") + ">Повторити (" + due + ")</button></div>";
  h += '<details><summary class="muted">Картки (' + cards.length + ')</summary><ul class="clist">' + cards.map((c) => {
    const l = level([c]);
    const lk = isAvail(c) || st(c) ? "" : ' class="locked"';
    const from = c.node === selNode ? "" : '<span class="muted">' + esc(c.node.title) + ": </span>";
    const note = !isActive(c) ? ' <span class="muted">(відкриється, коли тема повториться)</span>'
      : (isAvail(c) ? "" : ' <span class="muted">(відкриється після попередніх карток)</span>');
    const tag = c.t ? '<span class="tag">' + esc(c.t) + "</span> " : "";
    return "<li" + lk + '><span class="dot" style="background:var(--m' + l + ')"></span><span>' + tag + from + esc(c.q) + note + "</span></li>";
  }).join("") + "</ul></details>";
  el.innerHTML = h;
  el.hidden = false;
}

const openMap = () => { $("map").hidden = false; renderMap(); };
const closeMap = () => { $("map").hidden = true; };

// ===== Екрани =====
const FLAME_DOT = "<i></i>";

function renderChips() {
  const k = streak();
  let h = '<span class="streak' + (k ? "" : " off") + '" title="Серія днів із повторенням">' + FLAME_DOT + k + "</span>";
  if (S.syncError) h += '<button class="link warn" id="retry">не збережено, повторити</button>';
  h += '<button class="btn" id="addOpen">+ Картка</button><button class="btn" id="openMap">Мапа</button>';
  $("chips").innerHTML = h;
}

function loginHtml(msg) {
  return '<div class="login"><h1>ML <span>Cards</span></h1><p>Введи пароль</p>' +
    '<form id="loginForm"><input type="password" id="pw" placeholder="Пароль" autocomplete="current-password" autofocus required>' +
    '<button class="btn primary big wide" type="submit">Увійти</button><div class="err" id="loginErr">' + esc(msg || "") + "</div></form></div>";
}

function homeHtml() {
  const act = S.cards.filter(isActive);
  const inScope = scopeCards();
  const reviews = inScope.filter((c) => st(c) && st(c).due <= Date.now()).length;
  const newAvail = inScope.filter((c) => !st(c) && isAvail(c)).length;
  const newPlanned = Math.min(newAvail, remainingNew());
  const due = reviews + newPlanned;
  const ahead = Math.min(aheadCards().length, 20);
  const seen = act.filter((c) => st(c)).length;
  let h = '<div class="wrap">';
  h += '<p class="eyebrow">' + (scope === S.root ? "Сьогодні" : esc(scope.title)) + "</p>";
  h += '<div class="today"><span class="num">' + due + '</span><span class="lab">карток на сьогодні</span></div>';
  h += '<button class="btn primary big" id="start"' + (due ? "" : " disabled") + ">" + (due ? "Почати" : "На сьогодні все") + "</button>";
  if (!S.cards.length) h += '<p class="facts">Карток ще немає. Додай першу кнопкою «+ Картка» угорі.</p>';
  h += '<p class="facts">повторень <b>' + reviews + "</b> &middot; нових <b>" + newPlanned + "</b> (сьогодні нових " + newToday() + " з " + limitToday() + ")</p>";
  if (newAvail > newPlanned) {
    h += '<p class="facts"><button class="link" id="moreNew">Ще 10 нових</button> &middot; ще доступно нових: <b>' + (newAvail - newPlanned) + "</b></p>";
  }
  if (ahead) h += '<p class="facts"><button class="link" id="ahead">Повторити наперед (' + ahead + ')</button> &middot; ефект від раннього повторення менший</p>';
  h += '<p class="facts">вивчено <b>' + seen + "</b> з " + act.length + " &middot; сьогодні пройдено <b>" + todayCount() + "</b></p>";
  if (scope !== S.root) {
    h += '<div class="scope">Обрано одну гілку. <button class="link" id="clearScope">Усі теми</button></div>';
  }
  h += '<h3>Теми</h3><div class="tiles">';
  S.root.kids.forEach((n) => {
    const a = activeOf(n);
    const l = level(a);
    const pct = Math.round(mastery(a) * 100);
    const dueN = a.filter(isDue).length;
    const right = a.length ? (dueN ? dueN + " до повторення" : pct + "%") : "порожньо";
    const fillw = a.length ? Math.max(pct, a.some((c) => st(c)) ? 6 : 0) : 0;
    h += '<div class="tile" data-branch="' + esc(n.id) + '"><span class="tn">' + esc(n.title) + '</span><span class="tr">' + right + "</span>" +
      '<div class="pb"><i style="width:' + fillw + "%;background:var(--m" + (l || 4) + ')"></i></div></div>';
  });
  h += '</div><div class="foot"><button class="link" id="exportBtn">Зберегти прогрес у файл</button>' +
    '<button class="link" id="importBtn">Імпорт прогресу з файлу</button>' +
    '<button class="link" id="setLimit">Ліміт нових: ' + S.settings.new_per_day + '</button>' +
    '<button class="link" id="reset">Скинути прогрес</button><button class="link" id="logout">Вийти</button></div></div>';
  return h;
}

function reviewHtml() {
  const pct = Math.round(100 * session.done / session.total);
  let h = '<div class="rv"><div class="rvtop"><button class="x" id="stop" title="Завершити (Esc)">&times;</button>' +
    '<div class="pb"><i style="width:' + Math.max(pct, 2) + '%"></i></div><span>' + session.done + "/" + session.total + "</span></div>";
  h += '<div class="crumb">' + (current.t ? '<span class="tag">' + esc(current.t) + "</span>" : "") + esc(current.node.title) + "</div>";
  h += '<p class="q">' + esc(current.q) + "</p>";
  if (showAns) h += '<div class="ans">' + esc(current.a) + "</div>";
  h += '</div><div class="bottom"><div class="in">';
  if (!showAns) {
    h += '<button class="btn primary big wide" id="show">Показати відповідь</button>';
  } else {
    h += '<div class="grades">' +
      '<button class="g g0" data-g="0">Знову<small>' + hint(current, 0) + "</small></button>" +
      '<button class="g g1" data-g="1">Важко<small>' + hint(current, 1) + "</small></button>" +
      '<button class="g g2" data-g="2">Добре<small>' + hint(current, 2) + "</small></button>" +
      '<button class="g g3" data-g="3">Легко<small>' + hint(current, 3) + "</small></button></div>";
    h += '<button class="link known" data-g="4">Вже знаю (30 д)</button>';
  }
  h += "</div></div>";
  return h;
}

function summaryHtml() {
  const acc = session.tries ? Math.round(100 * session.good / session.tries) : 0;
  return '<div class="wrap"><div class="sum"><h2>Сесія пройдена</h2>' +
    "<p>Карток: <b>" + session.total + "</b></p>" +
    "<p>З першого разу добре: <b>" + acc + "%</b></p>" +
    "<p>Серія: <b>" + streak() + "</b> дн.</p>" +
    '<button class="btn primary big" id="done">Далі</button></div></div>';
}

function render(msg) {
  const logged = view !== "login" && view !== "loading";
  $("top").hidden = !logged || (view === "review" && !!current);
  const app = $("app");
  if (view === "loading") app.innerHTML = '<div class="loading">Завантаження...</div>';
  else if (view === "login") app.innerHTML = loginHtml(msg);
  else if (view === "review" && current) app.innerHTML = reviewHtml();
  else if (view === "summary") app.innerHTML = summaryHtml();
  else app.innerHTML = homeHtml();
  if (logged) renderChips();
  if (view === "login") $("pw").focus();
}

// ===== Сповіщення, форма нової картки =====
let toastTimer;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

function openAdd() {
  $("addQ").value = "";
  $("addA").value = "";
  $("modal").hidden = false;
  $("addQ").focus();
}
const closeAdd = () => { $("modal").hidden = true; };

async function saveCard(e) {
  e.preventDefault();
  const question = $("addQ").value.trim();
  const answer = $("addA").value.trim();
  if (!question || !answer) return;
  try {
    const row = await api.addCard({ id: "u-" + Date.now().toString(36), question, answer });
    addCardToModel(row);
    refreshInbox();
    closeAdd();
    toast("Додано в «Нерозподілені»");
    render();
  } catch (err) {
    toast("Не вдалось додати: " + err.message);
  }
}

// ===== Експорт, імпорт, скидання =====
function exportProgress() {
  const state = {};
  Object.entries(S.progress).forEach(([id, p]) => { state[id] = { iv: p.iv, reps: p.reps, due: p.due, first: p.first }; });
  const blob = new Blob([JSON.stringify({ state, meta: { days: S.activity } }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mlcards-progress-" + dayKey(0) + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importProgress(file) {
  try {
    const data = JSON.parse(await file.text());
    const known = new Set(S.cards.map((c) => c.id));
    const rows = [];
    Object.entries(data.state || {}).forEach(([id, p]) => {
      if (!known.has(id)) return;
      S.progress[id] = { iv: p.iv, reps: p.reps, due: p.due, first: p.first || null };
      rows.push({ card_id: id, iv: p.iv, reps: p.reps, due: new Date(p.due).toISOString(), first_seen: p.first || null });
    });
    const acts = Object.entries((data.meta && data.meta.days) || {}).map(([day, count]) => {
      S.activity[day] = Math.max(S.activity[day] || 0, count);
      return { day, count: S.activity[day] };
    });
    await api.saveProgress(rows);
    await api.saveActivity(acts);
    toast("Імпортовано карток: " + rows.length);
    render();
  } catch (err) {
    toast("Не вдалось імпортувати: " + err.message);
  }
}

// ===== Події =====
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-id],[data-g],[data-branch],#show,#stop,#start,#openMap,#mapClose,#sheetGo,#clearScope,#reset,#done,#addOpen,#addCancel,#exportBtn,#importBtn,#logout,#retry,#moreNew,#ahead,#setLimit");
  if (!el) return;
  if (el.dataset.id) {
    selNode = S.nodes[el.dataset.id];
    renderMap();
  } else if (el.id === "openMap") openMap();
  else if (el.id === "mapClose") closeMap();
  else if (el.id === "sheetGo") { scope = selNode; closeMap(); startReview(); }
  else if (el.dataset.branch) { scope = S.nodes[el.dataset.branch]; render(); }
  else if (el.id === "clearScope") { scope = S.root; render(); }
  else if (el.id === "start") startReview();
  else if (el.id === "moreNew") moreNew();
  else if (el.id === "ahead") startAhead();
  else if (el.id === "setLimit") setLimit();
  else if (el.id === "show") { showAns = true; render(); }
  else if (el.id === "stop" || el.id === "done") { current = null; queue = []; view = "home"; render(); }
  else if (el.id === "addOpen") openAdd();
  else if (el.id === "addCancel") closeAdd();
  else if (el.id === "exportBtn") exportProgress();
  else if (el.id === "importBtn") $("importFile").click();
  else if (el.id === "retry") flush();
  else if (el.id === "logout") {
    await api.signOut();
    view = "login";
    render();
  } else if (el.id === "reset") {
    if (!confirm("Скинути весь прогрес?")) return;
    try {
      await api.resetProgress();
      S.progress = {};
      S.activity = {};
      S.pending = {};
      S.pendingAct = {};
      render();
    } catch (err) {
      toast("Не вдалось скинути: " + err.message);
    }
  } else if (el.dataset.g !== undefined) grade(Number(el.dataset.g));
});

document.addEventListener("submit", async (e) => {
  if (e.target.id === "loginForm") {
    e.preventDefault();
    const pw = $("pw").value;
    try {
      await api.signIn(pw);
      await start();
    } catch (err) {
      const bad = /invalid login/i.test(err.message);
      $("loginErr").textContent = bad ? "Невірний пароль" : err.message;
    }
  }
});

$("addForm").addEventListener("submit", saveCard);
$("importFile").addEventListener("change", (e) => {
  if (e.target.files[0]) importProgress(e.target.files[0]);
  e.target.value = "";
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!$("modal").hidden) closeAdd();
    else if (!$("map").hidden) closeMap();
    else if (view === "review") { current = null; queue = []; view = "home"; render(); }
    return;
  }
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !$("modal").hidden) {
    $("addForm").requestSubmit();
    return;
  }
  if (view !== "review" || !current || !$("modal").hidden) return;
  if (e.code === "Space") {
    e.preventDefault();
    if (!showAns) { showAns = true; render(); }
  } else if (showAns && "12345".includes(e.key) && e.key) {
    grade(Number(e.key) - 1);
  }
});

window.addEventListener("online", flush);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });

// ===== Запуск =====
async function start() {
  view = "loading";
  render();
  try {
    buildModel(await api.loadAll());
  } catch (err) {
    view = "login";
    render("Не вдалось завантажити дані: " + err.message);
    return;
  }
  if (api.mode === "mock") window.__dbg = { S, isAvail, learned, st };  // лише для локальної перевірки
  scope = S.root;
  selNode = null;
  view = "home";
  renderLegend();
  render();
}

async function init() {
  render();
  if (api === undefined) {
    api = await createApi();
  }
  if (api.mode === "supabase" && CONFIG.SUPABASE_URL.includes(LOGO_PLACEHOLDER)) {
    view = "login";
    render("Заповни config.js: адреса й ключ Supabase.");
    return;
  }
  if (await api.hasSession()) await start();
  else { view = "login"; render(); }
}

init();
