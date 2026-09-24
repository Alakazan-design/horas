'use strict';

/*
 * Horas — conta o tempo trabalhado em cada item de cada projeto.
 * O tempo do projeto é a soma dos itens. Só um item conta por vez.
 *
 * O cronômetro guarda a hora em que você deu play (startedAt) e calcula o
 * tempo a partir dela, então continua certo mesmo com o app fechado.
 * Cada intervalo entre play e pausa vira uma sessão (início e fim), que
 * alimenta o relatório por dia, semana e mês.
 */

const STORE_KEY = 'horas.v1';
// Cores dos projetos, distribuídas nesta ordem fixa. A paleta foi validada para
// daltonismo e contraste sobre o fundo escuro: não reordenar nem trocar valores.
const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const OTHER_COLOR = '#8e8e93';
const OTHER_KEY = '*outros';
// Celular deitado: paisagem com pouca altura (exclui janelas de computador).
const FOCUS_QUERY = matchMedia('(orientation: landscape) and (max-height: 500px)');
const STATS_HASH = '#/relatorio';

const appEl = document.getElementById('app');
const nowbarEl = document.getElementById('nowbar');
const focusEl = document.getElementById('focus');

let state; // carregado no início (fim do arquivo), depois de tudo definido
let focusMode = false;
let lastScreen = null;

/* ---------- Ícones ---------- */

const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const LINE = 'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"';
const ICON = {
  play: svg('<path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.52.85l11.1-6.86a1 1 0 0 0 0-1.7L9.52 4.29A1 1 0 0 0 8 5.14z"/>'),
  pause: svg('<rect fill="currentColor" x="6" y="4.5" width="4.25" height="15" rx="1.25"/><rect fill="currentColor" x="13.75" y="4.5" width="4.25" height="15" rx="1.25"/>'),
  plus: svg(`<path ${LINE} stroke-width="2.2" d="M12 5v14M5 12h14"/>`),
  plusCircle: svg('<circle cx="12" cy="12" r="10" fill="currentColor"/><path fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" d="M12 7.5v9M7.5 12h9"/>'),
  more: svg(`<circle ${LINE} stroke-width="1.6" cx="12" cy="12" r="9.2"/><circle fill="currentColor" cx="7.8" cy="12" r="1.3"/><circle fill="currentColor" cx="12" cy="12" r="1.3"/><circle fill="currentColor" cx="16.2" cy="12" r="1.3"/>`),
  back: svg(`<path ${LINE} stroke-width="2.4" d="M15 4.5 7.5 12l7.5 7.5"/>`),
  chevron: svg(`<path ${LINE} stroke-width="2.2" d="m9.5 6 6 6-6 6"/>`),
  close: svg(`<path ${LINE} stroke-width="2.2" d="m7 7 10 10M17 7 7 17"/>`),
  rotate: svg(`<rect ${LINE} stroke-width="1.6" x="3" y="9" width="18" height="11" rx="2.5"/><path ${LINE} stroke-width="1.6" d="M7 5.5a7 7 0 0 1 10 0M17 5.5V3M17 5.5h-2.5"/>`),
  timer: svg(`<circle ${LINE} stroke-width="1.5" cx="12" cy="13.5" r="7.5"/><path ${LINE} stroke-width="1.5" d="M12 13.5v-4M10 2.75h4M12 2.75V6M18.25 6.75l1.25-1.25"/>`),
};

/* ---------- Estado e armazenamento ---------- */

// Próxima cor livre da paleta, na ordem fixa.
function nextColor(projects) {
  const used = new Set(projects.map((p) => p.color));
  return COLORS.find((c) => !used.has(c)) ?? COLORS[projects.length % COLORS.length];
}

function sumByItem(sessions) {
  const sums = new Map();
  for (const x of sessions) sums.set(x.i, (sums.get(x.i) || 0) + (x.e - x.s));
  return sums;
}

function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const now = Date.now();

  const projects = (Array.isArray(s.projects) ? s.projects : [])
    .filter((p) => p && p.id != null)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name ?? 'Projeto'),
      color: typeof p.color === 'string' ? p.color.toLowerCase() : '',
      createdAt: Number(p.createdAt) || now,
      items: (Array.isArray(p.items) ? p.items : [])
        .filter((it) => it && it.id != null)
        .map((it) => ({
          id: String(it.id),
          name: String(it.name ?? 'Item'),
          total: Math.max(0, Number(it.total) || 0),
          createdAt: Number(it.createdAt) || now,
        })),
    }));

  // Cores fora da paleta (ex.: da primeira versão) ganham a próxima cor livre, na ordem de criação.
  for (const p of projects) if (!COLORS.includes(p.color)) p.color = '';
  for (const p of projects) if (!p.color) p.color = nextColor(projects);

  const itemKeys = new Set(projects.flatMap((p) => p.items.map((it) => `${p.id}\n${it.id}`)));
  const sessions = (Array.isArray(s.sessions) ? s.sessions : [])
    .filter((x) => x && itemKeys.has(`${x.p}\n${x.i}`) && Number.isFinite(x.s) && Number.isFinite(x.e) && x.e > x.s)
    .map((x) => ({ p: String(x.p), i: String(x.i), s: x.s, e: x.e }))
    .sort((a, b) => a.e - b.e);

  // O total de um item nunca é menor que a soma das suas sessões.
  const logged = sumByItem(sessions);
  for (const p of projects) for (const it of p.items) it.total = Math.max(it.total, logged.get(it.id) || 0);

  const next = { version: 2, projects, sessions, active: null, startedAt: null };
  const a = s.active;
  if (a && itemKeys.has(`${a.projectId}\n${a.itemId}`)) {
    next.active = { projectId: String(a.projectId), itemId: String(a.itemId) };
    if (Number.isFinite(s.startedAt)) next.startedAt = s.startedAt;
  }
  return next;
}

const isBackup = (raw) => !!raw && typeof raw === 'object' && Array.isArray(raw.projects);

function load() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORE_KEY);
  } catch {}
  if (!saved) return normalize({});
  try {
    const raw = JSON.parse(saved);
    if (isBackup(raw)) return normalize(raw);
  } catch {}
  // Dados ilegíveis: guarda uma cópia antes de começar do zero, para não perder nada.
  try {
    localStorage.setItem(`${STORE_KEY}.ilegivel.${Date.now()}`, saved);
  } catch {}
  return normalize({});
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {}
}

function commit() {
  save();
  render();
}

const uid = () =>
  (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const getProject = (id) => state.projects.find((p) => p.id === id);
const getItem = (projectId, itemId) => getProject(projectId)?.items.find((it) => it.id === itemId);

function activeRef() {
  const a = state.active;
  if (!a) return null;
  const project = getProject(a.projectId);
  const item = project?.items.find((it) => it.id === a.itemId);
  return item ? { project, item } : null;
}

const isItemRunning = (itemId) => state.startedAt != null && state.active?.itemId === itemId;
const itemTime = (item, now = Date.now()) =>
  item.total + (isItemRunning(item.id) ? Math.max(0, now - state.startedAt) : 0);
const projectTime = (project, now = Date.now()) => project.items.reduce((sum, it) => sum + itemTime(it, now), 0);

/* ---------- Ações ---------- */

// Fecha a sessão em andamento: soma o tempo ao item e registra início e fim.
function pauseActive(now = Date.now()) {
  const ref = activeRef();
  if (ref && state.startedAt != null && now > state.startedAt) {
    ref.item.total += now - state.startedAt;
    state.sessions.push({ p: ref.project.id, i: ref.item.id, s: state.startedAt, e: now });
  }
  state.startedAt = null;
}

function toggleItem(projectId, itemId) {
  if (!getItem(projectId, itemId)) return;
  const now = Date.now();
  const wasRunning = isItemRunning(itemId);
  pauseActive(now);
  if (!wasRunning) {
    state.active = { projectId, itemId };
    state.startedAt = now;
  }
  commit();
}

function addProject(name) {
  const project = { id: uid(), name, color: nextColor(state.projects), createdAt: Date.now(), items: [] };
  state.projects.push(project);
  save();
  go(project.id);
}

function deleteProject(projectId) {
  if (state.active?.projectId === projectId) {
    state.active = null;
    state.startedAt = null;
  }
  state.projects = state.projects.filter((p) => p.id !== projectId);
  state.sessions = state.sessions.filter((x) => x.p !== projectId);
  save();
  go(null);
}

function addItem(projectId, name) {
  getProject(projectId)?.items.push({ id: uid(), name, total: 0, createdAt: Date.now() });
  commit();
}

function deleteItem(projectId, itemId) {
  const project = getProject(projectId);
  if (!project) return;
  if (state.active?.itemId === itemId) {
    state.active = null;
    state.startedAt = null;
  }
  project.items = project.items.filter((it) => it.id !== itemId);
  state.sessions = state.sessions.filter((x) => x.i !== itemId);
  commit();
}

// Tira tempo das sessões mais recentes do item (ex.: cronômetro esquecido ligado).
function trimSessions(itemId, amount) {
  const list = state.sessions;
  for (let k = list.length - 1; k >= 0 && amount > 0; k--) {
    const x = list[k];
    if (x.i !== itemId) continue;
    const cut = Math.min(amount, x.e - x.s);
    x.e -= cut;
    amount -= cut;
    if (x.e <= x.s) list.splice(k, 1);
  }
}

function setItemTime(projectId, itemId, ms) {
  const item = getItem(projectId, itemId);
  if (!item) return;
  const now = Date.now();
  const running = isItemRunning(itemId);
  if (running) pauseActive(now);
  const delta = ms - item.total;
  // Diminuir tira das sessões mais recentes; aumentar conta como trabalhado agora.
  if (delta < 0) trimSessions(itemId, -delta);
  else if (delta > 0) state.sessions.push({ p: projectId, i: itemId, s: now - delta, e: now });
  item.total = ms;
  if (running) state.startedAt = now;
  commit();
}

/* ---------- Formatação ---------- */

const pad = (n) => String(n).padStart(2, '0');

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// Duração para leitura: "3h 25min", "45min", "< 1min".
function fmtDur(ms) {
  const min = Math.floor(ms / 60000);
  if (ms > 0 && min === 0) return '< 1min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h ${m}min`;
}

const digits = (text) => text.replace(/:/g, '<span class="colon">:</span>');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESC[c]);

const itemsLabel = (n) => (n === 0 ? 'Nenhum item' : n === 1 ? '1 item' : `${n} itens`);

/* ---------- Navegação ---------- */

function currentRoute() {
  const hash = location.hash;
  if (hash === STATS_HASH) return { name: 'stats' };
  const m = hash.match(/^#\/p\/(.+)$/);
  if (m) {
    try {
      return { name: 'project', id: decodeURIComponent(m[1]) };
    } catch {}
  }
  return { name: 'home' };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

const go = (projectId) => navigate(projectId ? `#/p/${encodeURIComponent(projectId)}` : '#/');

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

/* ---------- Telas ---------- */

function render() {
  const route = currentRoute();
  const project = route.name === 'project' ? getProject(route.id) : null;
  const screen = route.name === 'stats' ? 'stats' : project ? project.id : 'home';
  const enter = screen !== lastScreen;
  lastScreen = screen;

  const html = screen === 'stats' ? renderStats() : project ? renderProject(project) : renderHome();
  appEl.innerHTML = `<div class="screen${enter ? ' screen--enter' : ''}">${html}</div>`;
  renderNowbar(project);
  if (focusMode) renderFocus();
}

function renderHome() {
  const now = Date.now();
  const running = state.startedAt != null ? activeRef() : null;

  const rows = state.projects
    .map((p) => {
      const live = running?.project.id === p.id;
      return `
        <li>
          <button class="row${live ? ' is-running' : ''}" style="--c:${p.color}" data-open="${esc(p.id)}">
            <span class="dot"></span>
            <span class="row-main">
              <span class="row-title">${esc(p.name)}</span>
              ${live
                ? `<span class="row-sub row-sub--live row-title">${esc(running.item.name)}</span>`
                : `<span class="row-sub">${itemsLabel(p.items.length)}</span>`}
            </span>
            <span class="row-time" data-time-project="${esc(p.id)}">${fmt(projectTime(p, now))}</span>
            <span class="chev">${ICON.chevron}</span>
          </button>
        </li>`;
    })
    .join('');

  const hasItems = state.projects.some((p) => p.items.length);

  return `
    <nav class="navbar">
      <div class="nav-actions">
        <button class="icon-btn" data-action="app-menu" aria-label="Backup">${ICON.more}</button>
        <button class="icon-btn" data-action="add-project" aria-label="Novo projeto">${ICON.plus}</button>
      </div>
    </nav>
    <h1 class="large-title">Projetos</h1>
    ${state.projects.length
      ? `${todayCardHtml(now)}
         <ul class="list list--dots">${rows}</ul>
         ${hasItems ? `<p class="hint">${ICON.rotate}Gire o celular para entrar no modo foco</p>` : ''}`
      : `<div class="empty">
           ${ICON.timer}
           <p class="empty-title">Nenhum projeto ainda</p>
           <p class="empty-text">Crie um projeto, adicione itens e dê play para começar a contar as horas.</p>
           <button class="btn" data-action="add-project">Criar projeto</button>
         </div>`}`;
}

function renderProject(p) {
  const now = Date.now();
  const pid = esc(p.id);

  const items = p.items
    .map((it) => {
      const running = isItemRunning(it.id);
      const iid = esc(it.id);
      return `
        <li class="item${running ? ' is-running' : ''}">
          <button class="row" data-item-menu="${iid}" data-project="${pid}">
            <span class="row-main">
              <span class="row-title">${esc(it.name)}</span>
              ${running ? '<span class="row-sub row-sub--live">Contando</span>' : ''}
            </span>
            <span class="row-time" data-time-item="${iid}">${fmt(itemTime(it, now))}</span>
          </button>
          <button class="play-btn${running ? ' is-running' : ''}" data-toggle="${iid}" data-project="${pid}"
            aria-label="${running ? 'Pausar' : 'Iniciar'} ${esc(it.name)}">${running ? ICON.pause : ICON.play}</button>
        </li>`;
    })
    .join('');

  return `
    <div style="--c:${p.color}">
      <nav class="navbar">
        <button class="back-btn" data-action="back">${ICON.back}Projetos</button>
        <div class="nav-actions">
          <button class="icon-btn" data-action="project-menu" data-project="${pid}" aria-label="Opções do projeto">${ICON.more}</button>
        </div>
      </nav>
      <h1 class="large-title">${esc(p.name)}</h1>
      <button class="hero" data-action="project-stats" data-project="${pid}">
        <span class="hero-top">
          <span class="hero-label"><span class="dot"></span>Tempo total</span>
          <span class="hero-link">Relatório${ICON.chevron}</span>
        </span>
        <span class="hero-time" data-time-project="${pid}">${fmt(projectTime(p, now))}</span>
      </button>
      ${p.items.length
        ? `<h2 class="section-title">Itens</h2>
           <ul class="list">
             ${items}
             <li><button class="row row--add" data-action="add-item" data-project="${pid}">${ICON.plusCircle}Novo item</button></li>
           </ul>`
        : `<div class="empty">
             <p class="empty-title">Nenhum item</p>
             <p class="empty-text">Os itens são as partes do projeto. Cada um tem seu próprio cronômetro.</p>
             <button class="btn" data-action="add-item" data-project="${pid}">Adicionar item</button>
           </div>`}
    </div>`;
}

// Barra fixa embaixo com o item atual. Some na tela do próprio projeto.
function renderNowbar(viewing) {
  const ref = activeRef();
  if (!ref || viewing?.id === ref.project.id) {
    nowbarEl.innerHTML = '';
    return;
  }
  const running = isItemRunning(ref.item.id);
  const enter = !nowbarEl.firstElementChild;
  const pid = esc(ref.project.id);
  const iid = esc(ref.item.id);
  nowbarEl.innerHTML = `
    <div class="nowbar${running ? ' is-running' : ''}${enter ? ' nowbar--enter' : ''}" style="--c:${ref.project.color}">
      <button class="nowbar-main" data-open="${pid}">
        <span class="dot"></span>
        <span class="nowbar-text">
          <span class="nowbar-title">${esc(ref.item.name)}</span>
          <span class="nowbar-sub">${esc(ref.project.name)}</span>
        </span>
        <span class="nowbar-time" data-time-item="${iid}">${fmt(itemTime(ref.item))}</span>
      </button>
      <button class="play-btn${running ? ' is-running' : ''}" data-toggle="${iid}" data-project="${pid}"
        aria-label="${running ? 'Pausar' : 'Iniciar'}">${running ? ICON.pause : ICON.play}</button>
    </div>`;
}

/* ---------- Relatório: períodos e somas ---------- */

// Filtros do relatório (ficam na memória enquanto o app está aberto).
const stats = { view: 'week', offset: 0, sel: null, project: null, back: '#/', backLabel: 'Projetos' };
const VIEWS = [['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês']];
const PLOT_H = 150;
const TICK_STEPS = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 480, 720, 1440].map((m) => m * 60000);
const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

const dtf = (opts) => new Intl.DateTimeFormat('pt-BR', opts);
const DATE = {
  weekday: dtf({ weekday: 'long' }),
  dayMonth: dtf({ day: 'numeric', month: 'long' }),
  dayMonthYear: dtf({ day: 'numeric', month: 'long', year: 'numeric' }),
  dayMonthShort: dtf({ day: 'numeric', month: 'short' }),
  weekdayDay: dtf({ weekday: 'short', day: 'numeric', month: 'short' }),
  month: dtf({ month: 'long' }),
  monthYear: dtf({ month: 'long', year: 'numeric' }),
  time: dtf({ hour: '2-digit', minute: '2-digit' }),
};
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1);

const dayStart = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
};
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayEdges = (first, count) => Array.from({ length: count + 1 }, (_, k) => addDays(first, k).getTime());

function fmtRange(a, b) {
  try {
    return DATE.dayMonthShort.formatRange(a, b);
  } catch {
    return `${DATE.dayMonthShort.format(a)} – ${DATE.dayMonthShort.format(b)}`;
  }
}

// Divide o período em barras: horas (dia), dias (semana e mês).
function getPeriod(view, offset, now) {
  const today = dayStart(now);
  const thisYear = today.getFullYear();

  if (view === 'day') {
    const d = addDays(today, offset);
    const edges = Array.from({ length: 25 }, (_, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h).getTime());
    const date = (d.getFullYear() === thisYear ? DATE.dayMonth : DATE.dayMonthYear).format(d);
    return {
      edges,
      title: offset === 0 ? 'Hoje' : offset === -1 ? 'Ontem' : cap(DATE.weekday.format(d)),
      subtitle: offset >= -1 ? `${DATE.weekday.format(d)}, ${date}` : date,
      labels: edges.slice(0, 24).map((_, h) => (h % 6 === 0 ? `${h}h` : '')),
      name: (k) => `${k}h – ${k + 1}h`,
    };
  }

  if (view === 'week') {
    const monday = addDays(today, -((today.getDay() + 6) % 7) + offset * 7);
    const sunday = addDays(monday, 6);
    const edges = dayEdges(monday, 7);
    const range = fmtRange(monday, sunday);
    return {
      edges,
      title: offset === 0 ? 'Esta semana' : offset === -1 ? 'Semana passada' : range,
      subtitle: offset >= -1 ? range : monday.getFullYear() === thisYear ? '' : String(monday.getFullYear()),
      labels: edges.slice(0, 7).map((t) => WEEKDAY_INITIALS[new Date(t).getDay()]),
      name: (k) => cap(DATE.weekdayDay.format(new Date(edges[k]))),
    };
  }

  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const edges = dayEdges(first, count);
  return {
    edges,
    title: offset === 0 ? 'Este mês' : offset === -1 ? 'Mês passado' : cap((first.getFullYear() === thisYear ? DATE.month : DATE.monthYear).format(first)),
    subtitle: offset >= -1 ? cap(DATE.monthYear.format(first)) : '',
    labels: edges.slice(0, count).map((_, k) => (k % 7 === 0 ? String(k + 1) : '')),
    name: (k) => cap(DATE.weekdayDay.format(new Date(edges[k]))),
  };
}

// Percorre as sessões, incluindo a que está em andamento.
function eachSession(now, fn) {
  for (const x of state.sessions) fn(x);
  const ref = state.startedAt != null ? activeRef() : null;
  if (ref && now > state.startedAt) fn({ p: ref.project.id, i: ref.item.id, s: state.startedAt, e: now, live: true });
}

// Soma o tempo de cada barra, separado por projeto (ou por item, com filtro de projeto).
// Uma sessão que atravessa a meia-noite é dividida entre os dois dias.
function aggregate(edges, now, projectId) {
  const n = edges.length - 1;
  const buckets = Array.from({ length: n }, () => ({ total: 0, by: new Map() }));
  eachSession(now, (x) => {
    if (x.e <= edges[0] || x.s >= edges[n] || (projectId && x.p !== projectId)) return;
    const key = projectId ? x.i : x.p;
    let k = 0;
    while (edges[k + 1] <= x.s) k++;
    for (; k < n && edges[k] < x.e; k++) {
      const overlap = Math.min(x.e, edges[k + 1]) - Math.max(x.s, edges[k]);
      if (overlap <= 0) continue;
      const b = buckets[k];
      b.total += overlap;
      b.by.set(key, (b.by.get(key) || 0) + overlap);
    }
  });
  return buckets;
}

const sumBuckets = (buckets) => buckets.reduce((sum, b) => sum + b.total, 0);
const isCurrent = (edges, k, now) => edges[k] <= now && now < edges[k + 1];

function earliestData() {
  let min = state.startedAt ?? Infinity;
  for (const x of state.sessions) if (x.s < min) min = x.s;
  return min;
}

// Dias do período que já começaram (para a média não contar dias futuros).
function elapsedDays(edges, now) {
  let n = 0;
  for (let k = 0; k < edges.length - 1; k++) if (edges[k] <= now) n++;
  return Math.max(1, n);
}

// Primeira e última atividade do dia.
function daySpan(from, to, now, projectId) {
  let first = Infinity;
  let last = -Infinity;
  let live = false;
  eachSession(now, (x) => {
    if (x.e <= from || x.s >= to || (projectId && x.p !== projectId)) return;
    first = Math.min(first, Math.max(x.s, from));
    last = Math.max(last, Math.min(x.e, to));
    if (x.live) live = true;
  });
  return first < Infinity ? { first, last, live } : null;
}

// Tempo registrado antes do histórico existir (não tem data, fica fora dos gráficos).
function undatedTime(projectId) {
  const logged = sumByItem(state.sessions);
  let sum = 0;
  for (const p of state.projects) {
    if (projectId && p.id !== projectId) continue;
    for (const it of p.items) sum += Math.max(0, it.total - (logged.get(it.id) || 0));
  }
  return sum;
}

function todayTotal(now) {
  return aggregate(dayEdges(dayStart(now), 1), now, null)[0].total;
}

// Séries do gráfico empilhado. A ordem é a da lista de projetos, para cada cor
// ficar sempre no mesmo lugar. Com mais de 8 projetos, os menores viram "Outros".
function chartSeries(buckets, project) {
  if (project) return [{ key: '*', color: project.color }];
  const totals = new Map();
  for (const b of buckets) for (const [key, v] of b.by) totals.set(key, (totals.get(key) || 0) + v);
  const list = state.projects
    .filter((p) => totals.get(p.id) > 0)
    .map((p) => ({ key: p.id, name: p.name, color: p.color, total: totals.get(p.id) }));
  if (list.length <= COLORS.length) return list;
  const top = new Set([...list].sort((a, b) => b.total - a.total).slice(0, COLORS.length - 1).map((s) => s.key));
  const rest = list.filter((s) => !top.has(s.key));
  return [
    ...list.filter((s) => top.has(s.key)),
    { key: OTHER_KEY, name: 'Outros', color: OTHER_COLOR, keys: rest.map((s) => s.key), total: rest.reduce((sum, s) => sum + s.total, 0) },
  ];
}

function valueOf(bucket, series) {
  if (series.key === '*') return bucket.total;
  if (series.keys) return series.keys.reduce((sum, key) => sum + (bucket.by.get(key) || 0), 0);
  return bucket.by.get(series.key) || 0;
}

// Linhas abaixo do gráfico: projetos (ou itens do projeto filtrado), maior primeiro.
function legendRows(buckets, sel, project, series) {
  const source = sel == null ? buckets : [buckets[sel]];
  if (project) {
    const totals = new Map();
    for (const b of source) for (const [key, v] of b.by) totals.set(key, (totals.get(key) || 0) + v);
    return project.items
      .filter((it) => totals.get(it.id) > 0)
      .map((it) => ({ name: it.name, value: totals.get(it.id), color: project.color }))
      .sort((a, b) => b.value - a.value);
  }
  return series
    .map((s) => ({ key: s.key, name: s.name, color: s.color, value: source.reduce((sum, b) => sum + valueOf(b, s), 0) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
}

/* ---------- Relatório: telas ---------- */

// Eixo com no máximo 3 linhas de grade, em valores redondos (no mínimo 1h).
function niceAxis(peak) {
  const max = Math.max(peak, 3600000);
  const step = TICK_STEPS.find((s) => s * 3 >= max) ?? Math.ceil(max / 3 / 86400000) * 86400000;
  const count = Math.ceil(max / step);
  return { top: count * step, ticks: Array.from({ length: count + 1 }, (_, k) => k * step) };
}

function fmtTick(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}min`;
  return min % 60 ? `${Math.floor(min / 60)}h${pad(min % 60)}` : `${min / 60}h`;
}

function fmtChange(change) {
  const pct = Math.round(Math.abs(change) * 100);
  return pct === 0 ? 'Igual' : `${change > 0 ? '▲' : '▼'} ${pct}%`;
}

function chartHtml(period, buckets, series, avg, sel, now) {
  const axis = niceAxis(Math.max(avg, ...buckets.map((b) => b.total)));
  const y = (v) => (v / axis.top) * PLOT_H;
  const avgY = avg > 0 ? y(avg) : null;

  const grid = axis.ticks
    .map((t) => {
      // Esconde o rótulo que ficaria em cima do rótulo "média".
      const label = t > 0 && avgY != null && Math.abs(y(t) - avgY) < 14 ? '' : `<span>${t === 0 ? '0' : fmtTick(t)}</span>`;
      return `<div class="gridline${t === 0 ? ' gridline--base' : ''}" style="bottom:${y(t).toFixed(1)}px">${label}</div>`;
    })
    .join('');
  const avgLine = avgY != null ? `<div class="avg-line" style="bottom:${avgY.toFixed(1)}px"><span>média</span></div>` : '';

  const bars = buckets
    .map((b, k) => {
      const parts = series.map((s) => [s, valueOf(b, s)]).filter(([, v]) => v > 0);
      const inner = Math.max(0, y(b.total) - 2 * Math.max(0, parts.length - 1));
      const segs = parts
        .map(([s, v]) => `<span class="seg" style="height:${((v / b.total) * inner).toFixed(2)}px;background:${s.color}"></span>`)
        .join('');
      const future = period.edges[k] > now;
      return `<button class="bar${sel === k ? ' is-sel' : ''}" data-bar="${k}"${future ? ' disabled' : ''} aria-pressed="${sel === k}"
        aria-label="${esc(`${period.name(k)}: ${fmtDur(b.total)}`)}"><span class="stack">${segs}</span></button>`;
    })
    .join('');

  const labels = period.labels
    .map((label, k) => `<span${isCurrent(period.edges, k, now) ? ' class="is-now"' : ''}>${label}</span>`)
    .join('');

  return `
    <div class="chart${sel != null ? ' has-sel' : ''}">
      <div class="plot" style="height:${PLOT_H}px">${grid}${avgLine}<div class="bars">${bars}</div></div>
      <div class="xaxis" aria-hidden="true">${labels}</div>
    </div>`;
}

// Cartão "Hoje" da tela inicial, com as barras da semana.
function todayCardHtml(now) {
  const period = getPeriod('week', 0, now);
  const buckets = aggregate(period.edges, now, null);
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const bars = buckets
    .map((b, k) => `
      <span class="spark-col${isCurrent(period.edges, k, now) ? ' is-now' : ''}">
        <span class="spark-bar" style="height:${Math.max(2, (b.total / max) * 30).toFixed(1)}px"></span>
        <span class="spark-label">${period.labels[k]}</span>
      </span>`)
    .join('');
  return `
    <button class="today-card" data-action="stats">
      <span class="today-main">
        <span class="today-label">Hoje</span>
        <span class="today-value" data-today-total>${fmtDur(todayTotal(now))}</span>
        <span class="today-link">Ver relatório</span>
      </span>
      <span class="spark" aria-hidden="true">${bars}</span>
    </button>`;
}

let lastStatsRender = 0;

function renderStats() {
  const now = Date.now();
  lastStatsRender = now;
  const project = stats.project ? getProject(stats.project) : null;
  if (!project) stats.project = null;

  const period = getPeriod(stats.view, stats.offset, now);
  const buckets = aggregate(period.edges, now, stats.project);
  const n = buckets.length;
  if (stats.sel != null && !(stats.sel < n && period.edges[stats.sel] <= now)) stats.sel = null;
  const sel = stats.sel;
  const total = sumBuckets(buckets);
  const earliest = earliestData();
  const series = chartSeries(buckets, project);

  let avg = 0;
  const kpis = [];
  if (stats.view === 'day') {
    const span = daySpan(period.edges[0], period.edges[n], now, stats.project);
    if (span) kpis.push(['Início', DATE.time.format(span.first)], ['Fim', span.live ? 'agora' : DATE.time.format(span.last)]);
  } else {
    const days = stats.offset === 0 ? elapsedDays(period.edges, now) : n;
    avg = total / days;
    kpis.push(['Média diária', fmtDur(avg)]);
    if (stats.view === 'month' && days >= 7) kpis.push(['Média semanal', fmtDur(avg * 7)]);
    // Compara médias diárias, só quando o histórico cobre o período anterior inteiro.
    const prev = getPeriod(stats.view, stats.offset - 1, now);
    const prevTotal = sumBuckets(aggregate(prev.edges, now, stats.project));
    if (total > 0 && prevTotal > 0 && earliest <= prev.edges[0]) {
      const label = stats.view === 'week' ? 'vs. semana anterior' : 'vs. mês anterior';
      kpis.push([label, fmtChange(avg / (prevTotal / (prev.edges.length - 1)) - 1)]);
    }
  }

  const rows = legendRows(buckets, sel, project, series);
  const max = Math.max(1, ...rows.map((r) => r.value));
  const undated = undatedTime(stats.project);

  const rowsHtml = rows
    .map((r) => {
      const clickable = !project && r.key !== OTHER_KEY;
      const tag = clickable ? 'button' : 'div';
      return `
        <li>
          <${tag} class="row stat-row"${clickable ? ` data-filter="${esc(r.key)}"` : ''}>
            ${project ? '' : `<span class="swatch" style="background:${r.color}"></span>`}
            <span class="row-main">
              <span class="row-title">${esc(r.name)}</span>
              <span class="meter"><span style="width:${Math.max(2, (r.value / max) * 100).toFixed(1)}%;background:${r.color}"></span></span>
            </span>
            <span class="row-time">${fmtDur(r.value)}</span>
            ${clickable ? `<span class="chev">${ICON.chevron}</span>` : ''}
          </${tag}>
        </li>`;
    })
    .join('');

  const emptyText = earliest < Infinity
    ? 'Nenhum tempo registrado neste período.'
    : 'O relatório começa a partir de agora: dê play em um item e o tempo aparece aqui, separado por dia.';

  return `
    <nav class="navbar">
      <button class="back-btn" data-action="stats-back">${ICON.back}${esc(stats.backLabel)}</button>
    </nav>
    <h1 class="large-title">Relatório</h1>
    <div class="segmented" role="group" aria-label="Período">
      ${VIEWS.map(([v, label]) => `<button data-view="${v}" aria-pressed="${stats.view === v}">${label}</button>`).join('')}
    </div>
    <div class="period">
      <button class="icon-btn" data-nav="-1" aria-label="Período anterior"${period.edges[0] > earliest ? '' : ' disabled'}>${ICON.back}</button>
      <div class="period-text">
        <span class="period-title">${esc(period.title)}</span>
        ${period.subtitle ? `<span class="period-sub">${esc(period.subtitle)}</span>` : ''}
      </div>
      <button class="icon-btn" data-nav="1" aria-label="Próximo período"${stats.offset < 0 ? '' : ' disabled'}>${ICON.chevron}</button>
    </div>
    ${project
      ? `<button class="chip" data-action="stats-all" aria-label="Mostrar todos os projetos">
           <span class="swatch" style="background:${project.color}"></span>${esc(project.name)}${ICON.close}
         </button>`
      : ''}
    <section class="stats-card">
      <div class="stat-label">${sel == null ? 'Total' : esc(period.name(sel))}</div>
      <div class="stat-hero">${fmtDur(sel == null ? total : buckets[sel].total)}</div>
      ${sel != null
        ? '<button class="link-btn" data-action="stats-clear-sel">Ver o período todo</button>'
        : kpis.length
          ? `<div class="kpis">${kpis.map(([l, v]) => `<div class="kpi"><span class="kpi-label">${l}</span><span class="kpi-value">${v}</span></div>`).join('')}</div>`
          : ''}
      ${chartHtml(period, buckets, series, avg, sel, now)}
    </section>
    ${rows.length
      ? `<h2 class="section-title">${project ? 'Itens' : 'Projetos'}</h2><ul class="list${project ? '' : ' list--dots'}">${rowsHtml}</ul>`
      : `<p class="stats-empty">${emptyText}</p>`}
    ${undated >= 60000
      ? `<p class="footnote">${fmtDur(undated)} registrados antes do relatório existir não têm data, por isso ficam fora dos gráficos. Eles continuam nos totais dos projetos.</p>`
      : ''}`;
}

function openStats(projectId) {
  const route = currentRoute();
  const from = route.name === 'project' ? getProject(route.id) : null;
  Object.assign(stats, {
    project: projectId || null,
    sel: null,
    back: from ? location.hash : '#/',
    backLabel: from ? from.name : 'Projetos',
  });
  navigate(STATS_HASH);
}

function setStats(patch) {
  Object.assign(stats, patch);
  render();
}

/* ---------- Modo foco ---------- */

function renderFocus() {
  const ref = activeRef();
  if (!ref) {
    focusEl.className = '';
    focusEl.innerHTML = `
      <div class="focus-empty">
        <strong>Nenhum item selecionado</strong>
        Volte o celular para a vertical e dê play em um item.
      </div>`;
    return;
  }
  const running = isItemRunning(ref.item.id);
  const time = fmt(itemTime(ref.item));
  focusEl.className = running ? 'is-running' : '';
  focusEl.style.setProperty('--c', ref.project.color);
  focusEl.innerHTML = `
    <div class="focus-inner">
      <div class="focus-label">
        <span class="dot"></span>
        <span class="focus-project">${esc(ref.project.name)}</span>
        <span aria-hidden="true">·</span>
        <span class="focus-item">${esc(ref.item.name)}</span>
      </div>
      <div class="focus-time" role="timer" data-focus-time="${time}">${digits(time)}</div>
      <button class="focus-btn" data-toggle="${esc(ref.item.id)}" data-project="${esc(ref.project.id)}"
        aria-label="${running ? 'Pausar' : 'Iniciar'}">${running ? ICON.pause : ICON.play}</button>
    </div>`;
  fitFocusTime();
}

// Deixa os números do cronômetro o maior possível sem estourar a tela.
function fitFocusTime() {
  const el = focusEl.querySelector('.focus-time');
  if (!focusMode || !el) return;
  const inner = el.parentElement;
  const cs = getComputedStyle(focusEl);
  el.style.fontSize = '100px';
  const availH = focusEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const maxH = Math.min(availH - (inner.offsetHeight - el.offsetHeight) - 48, availH * 0.52);
  const maxW = inner.clientWidth * 0.86;
  const size = Math.min((100 * maxW) / el.offsetWidth, maxH);
  el.style.fontSize = `${Math.max(24, Math.floor(size))}px`;
}

function updateMode() {
  const on = FOCUS_QUERY.matches;
  if (on === focusMode) return;
  focusMode = on;
  document.documentElement.classList.toggle('focus-mode', on);
  if (on) {
    document.activeElement?.blur?.();
    renderFocus();
    requestWakeLock();
    startShift();
  } else {
    releaseWakeLock();
    stopShift();
  }
}

FOCUS_QUERY.addEventListener('change', updateMode);
window.addEventListener('resize', () => {
  updateMode();
  fitFocusTime();
});

// Mantém a tela acesa enquanto o modo foco estiver aberto.
let wakeLock = null;
let wakePending = false;

async function requestWakeLock() {
  if (!focusMode || wakeLock || wakePending || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => {
      if (wakeLock === lock) wakeLock = null;
    });
    wakeLock = lock;
    if (!focusMode) releaseWakeLock();
  } catch {
    // Sem suporte ou negado: a tela apenas segue o bloqueio automático.
  } finally {
    wakePending = false;
  }
}

function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  lock?.release().catch(() => {});
}

// Alguns navegadores só liberam a tela acesa após um toque.
focusEl.addEventListener('pointerdown', requestWakeLock);

// Move o conteúdo alguns pixels a cada minuto para não marcar a tela OLED.
let shiftTimer = 0;

function startShift() {
  stopShift();
  shiftTimer = setInterval(() => {
    const offset = () => `${Math.round(Math.random() * 12 - 6)}px`;
    focusEl.style.setProperty('--shift-x', offset());
    focusEl.style.setProperty('--shift-y', offset());
  }, 60000);
}

function stopShift() {
  clearInterval(shiftTimer);
}

/* ---------- Relógio ---------- */

function setText(selector, text) {
  for (const el of document.querySelectorAll(selector)) {
    if (el.textContent !== text) el.textContent = text;
  }
}

function tick() {
  // Rede de segurança caso o aviso de rotação se perca.
  if (FOCUS_QUERY.matches !== focusMode) updateMode();
  if (state.startedAt == null) return;
  const ref = activeRef();
  if (!ref) return;
  const now = Date.now();
  const itemText = fmt(itemTime(ref.item, now));
  setText(`[data-time-item="${CSS.escape(ref.item.id)}"]`, itemText);
  setText(`[data-time-project="${CSS.escape(ref.project.id)}"]`, fmt(projectTime(ref.project, now)));
  if (document.querySelector('[data-today-total]')) setText('[data-today-total]', fmtDur(todayTotal(now)));

  const ft = focusMode && focusEl.querySelector('[data-focus-time]');
  if (ft && ft.dataset.focusTime !== itemText) {
    const refit = ft.dataset.focusTime.length !== itemText.length;
    ft.dataset.focusTime = itemText;
    ft.innerHTML = digits(itemText);
    if (refit) fitFocusTime();
  }

  // Com o relatório aberto, atualiza os números de tempos em tempos.
  if (!focusMode && lastScreen === 'stats' && now - lastStatsRender > 30000) render();
}

setInterval(tick, 250);

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  render();
  updateMode();
  requestWakeLock();
});

/* ---------- Diálogos ---------- */

function showDialog(className, html) {
  for (const old of document.querySelectorAll('dialog:not([open])')) old.remove();
  const dlg = document.createElement('dialog');
  dlg.className = className;
  dlg.innerHTML = html;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  // Toque fora do cartão fecha.
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.showModal();
  return dlg;
}

function fieldHtml(f) {
  const numeric = f.type === 'number';
  const attrs = [
    `name="${f.name}"`,
    `type="${numeric ? 'number' : 'text'}"`,
    `value="${esc(f.value ?? '')}"`,
    f.placeholder ? `placeholder="${esc(f.placeholder)}"` : '',
    f.max != null ? `max="${f.max}"` : '',
    numeric
      ? 'inputmode="numeric" pattern="[0-9]*" min="0" step="1"'
      : 'maxlength="80" autocapitalize="sentences" autocomplete="off" enterkeyhint="done"',
  ].join(' ');
  return `
    <label class="field">
      ${f.label ? `<span class="field-label">${esc(f.label)}</span>` : ''}
      <input ${attrs}>
    </label>`;
}

// Caixa central com campos opcionais. onSubmit pode devolver false para manter aberta.
function formDialog({ title, message = '', fields = [], submitLabel = 'Salvar', cancelLabel = 'Cancelar', danger = false, onSubmit }) {
  const dlg = showDialog(
    'dialog--alert',
    `<form class="alert" novalidate>
      <div class="alert-body">
        <h2 class="alert-title">${esc(title)}</h2>
        ${message ? `<p class="alert-msg">${esc(message)}</p>` : ''}
        ${fields.length ? `<div class="fields">${fields.map(fieldHtml).join('')}</div>` : ''}
      </div>
      <div class="alert-actions">
        ${cancelLabel ? `<button type="button" class="alert-btn" data-cancel>${esc(cancelLabel)}</button>` : ''}
        <button type="submit" class="alert-btn alert-btn--primary${danger ? ' is-danger' : ''}">${esc(submitLabel)}</button>
      </div>
    </form>`
  );
  const form = dlg.querySelector('form');
  dlg.querySelector('[data-cancel]')?.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (onSubmit?.(values) !== false) dlg.close();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    form.requestSubmit();
  });
  const input = form.querySelector('input');
  if (input) {
    input.focus();
    if (input.type === 'text') input.select();
  } else {
    form.querySelector('[type=submit]').focus();
  }
}

// Menu de opções que sobe de baixo, como no iOS.
function actionSheet({ title, actions }) {
  const dlg = showDialog(
    'dialog--sheet',
    `<div class="sheet" tabindex="-1" autofocus>
      <div class="sheet-group">
        ${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}
        ${actions.map((a, i) => `<button type="button" class="sheet-btn${a.danger ? ' is-danger' : ''}" data-sheet="${i}">${esc(a.label)}</button>`).join('')}
      </div>
      <button type="button" class="sheet-btn sheet-cancel" data-sheet-cancel>Cancelar</button>
    </div>`
  );
  dlg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-sheet]');
    if (btn) {
      dlg.close();
      // Chamado ainda dentro do toque, para o teclado abrir sozinho no iPhone.
      actions[Number(btn.dataset.sheet)].run();
    } else if (e.target.closest('[data-sheet-cancel]')) {
      dlg.close();
    }
  });
}

const cleanName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

function promptNewProject() {
  formDialog({
    title: 'Novo projeto',
    fields: [{ name: 'name', placeholder: 'Nome do projeto' }],
    submitLabel: 'Criar',
    onSubmit: ({ name }) => {
      name = cleanName(name);
      if (!name) return false;
      addProject(name);
    },
  });
}

function promptNewItem(projectId) {
  formDialog({
    title: 'Novo item',
    message: getProject(projectId)?.name,
    fields: [{ name: 'name', placeholder: 'Nome do item' }],
    submitLabel: 'Adicionar',
    onSubmit: ({ name }) => {
      name = cleanName(name);
      if (!name) return false;
      addItem(projectId, name);
    },
  });
}

function openProjectMenu(projectId) {
  const project = getProject(projectId);
  if (!project) return;
  actionSheet({
    title: project.name,
    actions: [
      { label: 'Ver relatório', run: () => openStats(projectId) },
      {
        label: 'Renomear projeto',
        run: () =>
          formDialog({
            title: 'Renomear projeto',
            fields: [{ name: 'name', value: project.name, placeholder: 'Nome do projeto' }],
            onSubmit: ({ name }) => {
              name = cleanName(name);
              if (!name) return false;
              project.name = name;
              commit();
            },
          }),
      },
      {
        label: 'Excluir projeto',
        danger: true,
        run: () =>
          formDialog({
            title: 'Excluir projeto?',
            message: `“${project.name}” e tudo dentro dele (${itemsLabel(project.items.length).toLowerCase()}, ${fmt(projectTime(project))}) serão apagados.`,
            submitLabel: 'Excluir',
            danger: true,
            onSubmit: () => deleteProject(projectId),
          }),
      },
    ],
  });
}

function openItemMenu(projectId, itemId) {
  const item = getItem(projectId, itemId);
  if (!item) return;
  actionSheet({
    title: `${item.name} · ${fmt(itemTime(item))}`,
    actions: [
      {
        label: 'Renomear',
        run: () =>
          formDialog({
            title: 'Renomear item',
            fields: [{ name: 'name', value: item.name, placeholder: 'Nome do item' }],
            onSubmit: ({ name }) => {
              name = cleanName(name);
              if (!name) return false;
              item.name = name;
              commit();
            },
          }),
      },
      { label: 'Ajustar tempo', run: () => promptAdjustTime(projectId, itemId) },
      {
        label: 'Excluir item',
        danger: true,
        run: () =>
          formDialog({
            title: 'Excluir item?',
            message: `“${item.name}” e ${fmt(itemTime(item))} registrados serão apagados.`,
            submitLabel: 'Excluir',
            danger: true,
            onSubmit: () => deleteItem(projectId, itemId),
          }),
      },
    ],
  });
}

function promptAdjustTime(projectId, itemId) {
  const item = getItem(projectId, itemId);
  if (!item) return;
  const current = itemTime(item);
  const h = Math.floor(current / 3600000);
  const m = Math.floor(current / 60000) % 60;
  formDialog({
    title: 'Ajustar tempo',
    message: 'Para corrigir o total. Diminuir tira tempo das sessões mais recentes; aumentar conta como trabalhado agora.',
    fields: [
      { name: 'h', label: 'Horas', type: 'number', value: h },
      { name: 'm', label: 'Minutos', type: 'number', value: m, max: 59 },
    ],
    onSubmit: (values) => {
      const nh = Math.max(0, Math.floor(Number(values.h) || 0));
      const nm = Math.min(59, Math.max(0, Math.floor(Number(values.m) || 0)));
      if (nh === h && nm === m) return; // nada mudou: mantém os segundos
      setItemTime(projectId, itemId, nh * 3600000 + nm * 60000);
    },
  });
}

/* ---------- Backup ---------- */

function openAppMenu() {
  actionSheet({
    title: 'Seus dados ficam só neste aparelho. Exporte um backup de vez em quando.',
    actions: [
      { label: 'Exportar backup', run: exportBackup },
      { label: 'Importar backup', run: importBackup },
    ],
  });
}

async function exportBackup() {
  const name = `horas-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([JSON.stringify(state, null, 2)], name, { type: 'application/json' });
  // No celular abre a folha de compartilhar (Salvar em Arquivos, AirDrop…).
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
    } catch {}
    return;
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function importBackup() {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch {}
    if (!isBackup(raw)) {
      formDialog({ title: 'Arquivo inválido', message: 'Não foi possível ler este backup.', submitLabel: 'OK', cancelLabel: null });
      return;
    }
    const data = normalize(raw);
    formDialog({
      title: 'Importar backup?',
      message: `${data.projects.length} projeto(s) no arquivo. Os dados atuais serão substituídos.`,
      submitLabel: 'Importar',
      danger: true,
      onSubmit: () => {
        state = data;
        save();
        go(null);
      },
    });
  });
  input.click();
}

/* ---------- Toques ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-toggle], [data-open], [data-item-menu], [data-action], [data-view], [data-nav], [data-bar], [data-filter]');
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.toggle) return toggleItem(d.project, d.toggle);
  if (d.open) return go(d.open);
  if (d.itemMenu) return openItemMenu(d.project, d.itemMenu);
  if (d.view) return setStats({ view: d.view, offset: 0, sel: null });
  if (d.nav) return setStats({ offset: Math.min(0, stats.offset + Number(d.nav)), sel: null });
  if (d.bar) return setStats({ sel: stats.sel === Number(d.bar) ? null : Number(d.bar) });
  if (d.filter) return setStats({ project: d.filter, sel: null });
  switch (d.action) {
    case 'add-project': return promptNewProject();
    case 'add-item': return promptNewItem(d.project);
    case 'project-menu': return openProjectMenu(d.project);
    case 'app-menu': return openAppMenu();
    case 'back': return go(null);
    case 'stats': return openStats(null);
    case 'project-stats': return openStats(d.project);
    case 'stats-back': return navigate(stats.back);
    case 'stats-all': return setStats({ project: null, sel: null });
    case 'stats-clear-sel': return setStats({ sel: null });
  }
});

/* ---------- Início ---------- */

state = load();
render();
updateMode();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
navigator.storage?.persist?.().catch(() => {});
