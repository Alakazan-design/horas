'use strict';

/*
 * Horas — conta o tempo trabalhado em cada item de cada projeto.
 * O tempo do projeto é a soma dos itens. Só um item conta por vez.
 *
 * O cronômetro guarda a hora em que você deu play (startedAt) e calcula o
 * tempo a partir dela, então continua certo mesmo com o app fechado.
 */

const STORE_KEY = 'horas.v1';
const COLORS = ['#FF9F0A', '#64D2FF', '#30D158', '#FF375F', '#BF5AF2', '#FFD60A', '#63E6E2', '#0A84FF'];
// Celular deitado: paisagem com pouca altura (exclui janelas de computador).
const FOCUS_QUERY = matchMedia('(orientation: landscape) and (max-height: 500px)');

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
  rotate: svg(`<rect ${LINE} stroke-width="1.6" x="3" y="9" width="18" height="11" rx="2.5"/><path ${LINE} stroke-width="1.6" d="M7 5.5a7 7 0 0 1 10 0M17 5.5V3M17 5.5h-2.5"/>`),
  timer: svg(`<circle ${LINE} stroke-width="1.5" cx="12" cy="13.5" r="7.5"/><path ${LINE} stroke-width="1.5" d="M12 13.5v-4M10 2.75h4M12 2.75V6M18.25 6.75l1.25-1.25"/>`),
};

/* ---------- Estado e armazenamento ---------- */

function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const now = Date.now();
  const color = (c, i) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : COLORS[i % COLORS.length]);

  const projects = (Array.isArray(s.projects) ? s.projects : [])
    .filter((p) => p && p.id != null)
    .map((p, i) => ({
      id: String(p.id),
      name: String(p.name ?? 'Projeto'),
      color: color(p.color, i),
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

  const next = { version: 1, projects, active: null, startedAt: null, colorIndex: Number(s.colorIndex) || projects.length };
  const a = s.active;
  if (a && projects.some((p) => p.id === String(a.projectId) && p.items.some((it) => it.id === String(a.itemId)))) {
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

// Fecha a sessão em andamento, somando o tempo ao item.
function pauseActive(now = Date.now()) {
  const ref = activeRef();
  if (ref && state.startedAt != null) ref.item.total += Math.max(0, now - state.startedAt);
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
  const project = {
    id: uid(),
    name,
    color: COLORS[state.colorIndex++ % COLORS.length],
    createdAt: Date.now(),
    items: [],
  };
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
  commit();
}

function setItemTime(projectId, itemId, ms) {
  const item = getItem(projectId, itemId);
  if (!item) return;
  // Se estiver contando, recomeça a contagem a partir do novo valor.
  if (isItemRunning(itemId)) state.startedAt = Date.now();
  item.total = ms;
  commit();
}

/* ---------- Formatação ---------- */

const pad = (n) => String(n).padStart(2, '0');

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

const digits = (text) => text.replace(/:/g, '<span class="colon">:</span>');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ESC[c]);

const itemsLabel = (n) => (n === 0 ? 'Nenhum item' : n === 1 ? '1 item' : `${n} itens`);

/* ---------- Navegação ---------- */

function currentProjectId() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

function go(projectId) {
  const hash = projectId ? `#/p/${encodeURIComponent(projectId)}` : '#/';
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

/* ---------- Telas ---------- */

function render() {
  const project = getProject(currentProjectId());
  const screen = project ? project.id : 'home';
  const enter = screen !== lastScreen;
  lastScreen = screen;

  appEl.innerHTML = `<div class="screen${enter ? ' screen--enter' : ''}">${project ? renderProject(project) : renderHome()}</div>`;
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
      ? `<ul class="list list--dots">${rows}</ul>
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
      <div class="hero">
        <span class="hero-label">Tempo total</span>
        <span class="hero-time" data-time-project="${pid}">${fmt(projectTime(p, now))}</span>
      </div>
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

  const ft = focusMode && focusEl.querySelector('[data-focus-time]');
  if (ft && ft.dataset.focusTime !== itemText) {
    const refit = ft.dataset.focusTime.length !== itemText.length;
    ft.dataset.focusTime = itemText;
    ft.innerHTML = digits(itemText);
    if (refit) fitFocusTime();
  }
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
    message: 'Corrija o total se esqueceu o cronômetro ligado.',
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
  const el = e.target.closest('[data-toggle], [data-open], [data-item-menu], [data-action]');
  if (!el) return;
  const { toggle, open, itemMenu, action, project } = el.dataset;
  if (toggle) return toggleItem(project, toggle);
  if (open) return go(open);
  if (itemMenu) return openItemMenu(project, itemMenu);
  switch (action) {
    case 'add-project': return promptNewProject();
    case 'add-item': return promptNewItem(project);
    case 'project-menu': return openProjectMenu(project);
    case 'app-menu': return openAppMenu();
    case 'back': return go(null);
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
