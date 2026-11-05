'use strict';
/* Workbench — project tracker PWA. All data lives on the device:
   projects in localStorage, photos in IndexedDB. No server. */

const APP_VERSION = '1.0.1';
const KEY = 'workbench.v1';
const COLORS = ['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0c7', '#007aff', '#5856d6', '#af52de', '#ff2d55', '#a2845e', '#8e8e93'];
const STATUSES = { active: 'Active', waiting: 'Waiting', paused: 'Paused', done: 'Done' };
const PRIORITIES = { high: 'High', med: 'Medium', low: 'Low' };
const FILTERS = [
  ['open', 'Open'], ['active', 'Active'], ['waiting', 'Waiting'], ['paused', 'Paused'],
  ['idle', 'Idle'], ['done', 'Done'], ['all', 'All'],
];
const SORTS = { smart: 'Smart', deadline: 'Deadline', priority: 'Priority', recent: 'Recently worked', name: 'Name', created: 'Newest' };

/* ---------------- utilities ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => ymd(new Date());
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const daysUntil = (s) => Math.round((parseYmd(s) - parseYmd(todayStr())) / 86400000);
const daysSince = (iso) => (iso ? Math.round((parseYmd(todayStr()) - parseYmd(ymd(new Date(iso)))) / 86400000) : Infinity);
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const money = (n) => Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n % 1 ? 2 : 0 });
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

function fmtDate(s, opts = {}) {
  const d = parseYmd(s);
  return d.toLocaleDateString(undefined, {
    weekday: opts.weekday === false ? undefined : 'short', month: 'short', day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}
function relDate(iso) {
  const n = daysSince(iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n < 7) return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: n > 300 ? '2-digit' : undefined });
}
function deadlineInfo(p) {
  if (!p.deadline || p.status === 'done') return null;
  const n = daysUntil(p.deadline);
  if (n < 0) return { n, cls: 'over', text: `${-n}d overdue` };
  if (n === 0) return { n, cls: 'today', text: 'Due today' };
  if (n === 1) return { n, cls: 'soon', text: 'Due tomorrow' };
  if (n <= 7) return { n, cls: 'soon', text: `${n} days left` };
  if (n <= 30) return { n, cls: 'near', text: `${n} days left` };
  return { n, cls: 'far', text: fmtDate(p.deadline, { weekday: false }) };
}

/* ---------------- state ---------------- */
function blankState() {
  return {
    version: 1, projects: [],
    settings: { theme: 'auto', staleDays: 14, lastBackup: null, badge: false, installDismissed: false, sort: 'smart', filter: 'open', shopGroup: 'project' },
  };
}
function normalize(p) {
  p.steps ||= []; p.items ||= []; p.log ||= []; p.photos ||= [];
  p.status ||= 'active'; p.priority ||= 'med'; p.color ||= COLORS[6];
  p.created ||= now(); p.updated ||= p.created;
  return p;
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.projects)) {
      s.settings = { ...blankState().settings, ...s.settings };
      s.projects.forEach(normalize);
      return s;
    }
  } catch (e) { /* fall through */ }
  return blankState();
}
let state = loadState();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save — device storage is full'); }
  updateBadges();
}
const getP = (id) => state.projects.find((p) => p.id === id);
function touch(p, worked = false) { p.updated = now(); if (worked) p.lastWorked = now(); }
const nextStep = (p) => p.steps.find((s) => !s.done);
const openSteps = (p) => p.steps.filter((s) => !s.done);
const neededItems = (p) => p.items.filter((i) => !i.have);
const isIdle = (p) => p.status === 'active' && state.settings.staleDays > 0 &&
  daysSince(p.lastWorked || p.created) >= state.settings.staleDays;
function addLog(p, text, kind = 'note', hours = 0) {
  p.log.unshift({ id: uid(), at: now(), text, kind, hours: hours || 0 });
}

/* unsaved new/edit form, kept so it survives the app being backgrounded or killed */
const DRAFT_KEY = 'workbench.draft';
function readDraft() {
  try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); return d && d.route && d.values ? d : null; }
  catch (e) { return null; }
}
function saveDraft(f) {
  const values = {};
  for (const el of f.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') { if (el.checked) values[el.name] = el.value; } else values[el.name] = el.value;
  }
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ route: route().join('/'), at: now(), values })); } catch (e) { /* storage full */ }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }
function restoreDraft(f) {
  const d = readDraft();
  if (!f || !d || d.route !== route().join('/')) return false;
  for (const el of f.elements) {
    if (!el.name || !(el.name in d.values)) continue;
    if (el.type === 'radio') el.checked = el.value === d.values[el.name];
    else el.value = d.values[el.name];
  }
  return true;
}
// A draft that still points at something real (an edit draft needs its project to exist).
function liveDraft() {
  const d = readDraft(); if (!d) return null;
  const [r0, id] = d.route.split('/');
  if (r0 === 'new' || (r0 === 'edit' && getP(id))) return d;
  clearDraft(); return null;
}

/* undo (one level, in-session) */
let undoSnap = null;
const snapshot = () => { undoSnap = JSON.stringify(state.projects); };
function undo() {
  if (!undoSnap) return;
  state.projects = JSON.parse(undoSnap); undoSnap = null;
  save(); render(); toast('Undone');
}

/* ---------------- photo storage (IndexedDB) ---------------- */
const PhotoDB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('workbench-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async run(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('photos', mode);
      const req = fn(t.objectStore('photos'));
      t.oncomplete = () => res(req.result);
      t.onerror = () => rej(t.error);
    });
  },
  put: (rec) => PhotoDB.run('readwrite', (s) => s.put(rec)),
  get: (id) => PhotoDB.run('readonly', (s) => s.get(id)),
  del: (id) => PhotoDB.run('readwrite', (s) => s.delete(id)),
  all: () => PhotoDB.run('readonly', (s) => s.getAll()),
  keys: () => PhotoDB.run('readonly', (s) => s.getAllKeys()),
  clear: () => PhotoDB.run('readwrite', (s) => s.clear()),
};
const urlCache = new Map();

async function loadImage(file) {
  try { return await createImageBitmap(file); } catch (e) { /* older Safari */ }
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file);
  });
}
async function resizeTo(src, max, q) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', q));
}
async function hydratePhotos() {
  for (const img of $$('img[data-photo]')) {
    const id = img.dataset.photo, size = img.dataset.size || 'thumb', k = id + size;
    if (!urlCache.has(k)) {
      const r = await PhotoDB.get(id).catch(() => null);
      if (!r) continue;
      urlCache.set(k, URL.createObjectURL(size === 'full' ? r.blob : (r.thumb || r.blob)));
    }
    img.src = urlCache.get(k);
  }
}
const blobToDataURL = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
function dataURLToBlob(u) {
  const [head, body] = u.split(',');
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(body); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ---------------- UI helpers ---------------- */
const ui = { search: '', editSteps: false, editItems: false, showDone: false, showAllLog: false, itemType: 'material', shopChecked: new Set(), lastRoute: null, focus: null };

let toastTimer;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button" id="toastBtn">${esc(action.label)}</button>` : ''}`;
  t.classList.add('show');
  if (action) $('#toastBtn').onclick = () => { t.classList.remove('show'); action.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 5500 : 2600);
}
const undoToast = (msg) => toast(msg, { label: 'Undo', fn: undo });

function sheet({ title, message, actions }) {
  return new Promise((res) => {
    const el = $('#sheet');
    el.innerHTML = `<div class="sheet-backdrop" data-sheet="-1"></div><div class="sheet-panel">
      ${title || message ? `<div class="sheet-head">${title ? `<div class="sheet-title">${esc(title)}</div>` : ''}${message ? `<div class="sheet-msg">${esc(message)}</div>` : ''}</div>` : ''}
      <div class="sheet-group">${actions.map((a, i) => `<button type="button" class="sheet-btn ${a.style || ''}" data-sheet="${i}">${esc(a.label)}</button>`).join('')}</div>
      <button type="button" class="sheet-btn cancel" data-sheet="-1">Cancel</button></div>`;
    el.hidden = false;
    el.onclick = (e) => {
      const b = e.target.closest('[data-sheet]'); if (!b) return;
      const i = +b.dataset.sheet;
      el.hidden = true; el.innerHTML = ''; el.onclick = null;
      res(i < 0 ? null : (actions[i].value ?? i));
    };
  });
}

async function shareOrDownload(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}
async function shareText(text, title) {
  if (navigator.share) {
    try { await navigator.share({ text, title }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch (e) { toast('Sharing not supported here'); }
}

const ICON = {
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/></svg>',
};

/* ---------------- router ---------------- */
const route = () => (location.hash.slice(1) || '/').split('/').filter(Boolean);
const go = (h) => { location.hash = h; };
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

function render() {
  const r = route(), key = r.join('/');
  if (key !== ui.lastRoute) {
    Object.assign(ui, { editSteps: false, editItems: false, showDone: false, showAllLog: false, lastRoute: key });
    if (r[0] !== 'shop') ui.shopChecked.clear();
  }
  const v = $('#view');
  let tab = 'home';
  switch (r[0]) {
    case undefined: v.innerHTML = viewHome(); renderCards(); break;
    case 'p': {
      const p = getP(r[1]);
      if (!p) { location.replace('#/'); return; }
      v.innerHTML = viewDetail(p); break;
    }
    case 'new': v.innerHTML = viewEdit(null); if (restoreDraft($('#pform'))) toast('Restored your unsaved project'); break;
    case 'edit': {
      const p = getP(r[1]);
      if (!p) { location.replace('#/'); return; }
      v.innerHTML = viewEdit(p); if (restoreDraft($('#pform'))) toast('Restored your unsaved changes'); break;
    }
    case 'shop': tab = 'shop'; v.innerHTML = viewShop(); break;
    case 'cal': tab = 'cal'; v.innerHTML = viewUpcoming(); break;
    case 'settings': tab = 'settings'; v.innerHTML = viewSettings(); fillStorageInfo(); break;
    default: location.replace('#/'); return;
  }
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  document.body.classList.toggle('no-tabs', r[0] === 'new' || r[0] === 'edit');
  hydratePhotos();
  if (ui.focus) { const el = $(ui.focus); if (el) el.focus(); ui.focus = null; }
  updateBadges();
}

/* ---------------- views: home ---------------- */
function viewHome() {
  const ps = state.projects, s = state.settings;
  let banners = '';
  if (isIOS() && !isStandalone() && !s.installDismissed) {
    banners += `<div class="banner"><div class="grow"><b>Install on your iPhone</b>Tap <b style="display:inline">Share</b> → <b style="display:inline">Add to Home Screen</b> so it opens full-screen, works offline and keeps your data safe.</div><button class="x" data-act="dismissInstall" aria-label="Dismiss">×</button></div>`;
  }
  const draft = liveDraft();
  if (draft) {
    const isNew = draft.route.startsWith('new');
    const name = draft.values.name?.trim() || (isNew ? '' : getP(draft.route.split('/')[1])?.name);
    banners += `<div class="banner"><div class="grow"><b>${isNew ? 'Unsaved new project' : 'Unsaved edits'}</b>${name ? `“${esc(name)}” — ` : ''}pick up where you left off.</div><button class="btn" data-act="resumeDraft">Resume</button><button class="x" data-act="discardDraft" aria-label="Discard draft">×</button></div>`;
  }
  const backupAge = s.lastBackup ? daysSince(s.lastBackup) : Infinity;
  if (ps.length >= 1 && backupAge > 30) {
    banners += `<div class="banner warn"><div class="grow"><b>${s.lastBackup ? `Last backup ${backupAge} days ago` : 'No backup yet'}</b>Data lives only on this device. Save a backup to Files / iCloud Drive.</div><button class="btn" data-act="exportBackup">Back up</button></div>`;
  }
  if (!ps.length) {
    return `<header class="large"><h1>Projects</h1><a class="icon-btn" href="#/new" aria-label="New project">${ICON.plus}</a></header>${banners}
      <div class="empty"><div class="big">🛠️</div><h2>No projects yet</h2>
      <p>Track what you're building: the next step, what tools and materials you still need, and when it's due.</p>
      <a class="btn primary" href="#/new">Create a project</a><br>
      <button class="btn" data-act="loadExample">Load an example</button></div>`;
  }
  const open = ps.filter((p) => p.status !== 'done');
  const due = (p) => (p.deadline ? daysUntil(p.deadline) : null);
  const overdue = open.filter((p) => p.deadline && due(p) < 0).length;
  const week = open.filter((p) => p.deadline && due(p) >= 0 && due(p) <= 7).length;
  const toBuy = open.reduce((n, p) => n + neededItems(p).length, 0);
  const idle = open.filter(isIdle).length;
  const counts = {
    open: open.length, all: ps.length, idle,
    ...Object.fromEntries(Object.keys(STATUSES).map((k) => [k, ps.filter((p) => p.status === k).length])),
  };
  return `
    <header class="large"><h1>Projects</h1><a class="icon-btn" href="#/new" aria-label="New project">${ICON.plus}</a></header>
    ${banners}
    <div class="stats">
      <a href="#/cal" class="stat ${overdue ? 'red' : ''}"><b>${overdue}</b><span>Overdue</span></a>
      <a href="#/cal" class="stat"><b>${week}</b><span>Due ≤ 7d</span></a>
      <a href="#/shop" class="stat"><b>${toBuy}</b><span>To get</span></a>
      <button type="button" class="stat ${s.filter === 'idle' ? 'on' : ''}" data-act="filter" data-f="idle"><b>${idle}</b><span>Idle</span></button>
    </div>
    <div class="search"><input type="search" id="search" placeholder="Search projects, steps, items" value="${esc(ui.search)}" data-input="search" autocomplete="off"></div>
    <div class="chips">${FILTERS.filter(([k]) => counts[k] || k === 'open' || k === s.filter)
      .map(([k, l]) => `<button type="button" class="chip ${s.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}<i>${counts[k]}</i></button>`).join('')}</div>
    <div class="sortrow">Sort:<select data-change="sort" aria-label="Sort">${Object.entries(SORTS).map(([k, l]) => `<option value="${k}" ${s.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div id="plist"></div>`;
}

function matchesSearch(p, q) {
  if (!q) return true;
  const hay = [p.name, p.category, p.desc, p.notes, p.waitingOn, ...p.steps.map((s) => s.text), ...p.items.map((i) => `${i.name} ${i.store || ''}`)].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}
function smartScore(p) {
  const st = { active: 0, waiting: 1, paused: 2, done: 3 }[p.status] ?? 0;
  const d = p.deadline && p.status !== 'done' ? daysUntil(p.deadline) : null;
  let s = st * 1e6;
  if (d !== null && d <= 14) s += 100 + d; // urgent deadlines first
  else s += 1000 + { high: 0, med: 100, low: 200 }[p.priority] + Math.min(daysSince(p.lastWorked || p.created), 99);
  return s;
}
function sortProjects(list) {
  const by = state.settings.sort;
  const cmp = {
    smart: (a, b) => smartScore(a) - smartScore(b),
    deadline: (a, b) => (a.deadline || '9999') .localeCompare(b.deadline || '9999'),
    priority: (a, b) => ({ high: 0, med: 1, low: 2 }[a.priority] - { high: 0, med: 1, low: 2 }[b.priority]) || smartScore(a) - smartScore(b),
    recent: (a, b) => (b.lastWorked || b.created).localeCompare(a.lastWorked || a.created),
    name: (a, b) => a.name.localeCompare(b.name),
    created: (a, b) => b.created.localeCompare(a.created),
  }[by] || ((a, b) => smartScore(a) - smartScore(b));
  return list.sort(cmp);
}
function renderCards() {
  const el = $('#plist'); if (!el) return;
  const f = state.settings.filter;
  let list = state.projects.filter((p) => {
    if (f === 'open') return p.status !== 'done';
    if (f === 'idle') return isIdle(p);
    if (f === 'all') return true;
    return p.status === f;
  }).filter((p) => matchesSearch(p, ui.search.trim()));
  list = sortProjects(list);
  el.innerHTML = list.length ? list.map(projectCard).join('')
    : `<div class="empty" style="padding-top:30px">${ui.search ? 'No matches.' : f === 'idle' ? 'Nothing idle — nice momentum!' : 'Nothing here.'}</div>`;
  hydratePhotos();
}
function projectCard(p) {
  const dl = deadlineInfo(p);
  const ns = nextStep(p);
  const total = p.steps.length, done = total - openSteps(p).length;
  const need = neededItems(p).length;
  const idleDays = isIdle(p) ? daysSince(p.lastWorked || p.created) : 0;
  const cover = p.cover && p.photos.includes(p.cover) ? p.cover : p.photos[0];
  let next;
  if (p.status === 'done') next = `<span class="lbl">✓</span><span class="txt muted">Completed ${p.completedAt ? relDate(p.completedAt).toLowerCase() : ''}</span>`;
  else if (p.status === 'waiting') next = `<span class="lbl">⏳</span><span class="txt">Waiting on ${esc(p.waitingOn || '…')}</span>`;
  else if (ns) next = `<span class="lbl">Next</span><span class="txt">${esc(ns.text)}</span><button type="button" class="quick-done" data-act="stepDone" data-id="${p.id}" data-sid="${ns.id}" aria-label="Mark next step done"></button>`;
  else next = `<span class="lbl">Next</span><span class="txt muted">${total ? 'All steps done — wrap it up?' : 'No steps yet — add one'}</span>`;
  return `<div class="pcard" style="--c:${p.color}" data-act="open" data-id="${p.id}" role="link" tabindex="0">
    <div class="pc-main">
      <div class="pc-top"><span class="pc-name">${esc(p.name)}</span>${dl ? `<span class="badge ${dl.cls}">${dl.text}</span>` : ''}${p.status === 'paused' ? '<span class="badge">Paused</span>' : ''}</div>
      ${p.category || p.priority === 'high' ? `<div class="pc-cat">${p.priority === 'high' ? '<span class="prio high"></span>High priority' : ''}${p.category && p.priority === 'high' ? ' · ' : ''}${esc(p.category || '')}</div>` : ''}
      <div class="pc-next">${next}</div>
      <div class="pc-foot">
        ${total ? `<div class="bar"><i style="width:${(done / total) * 100}%"></i></div><span>${done}/${total}</span>` : ''}
        ${need ? `<span>🛒 ${need}</span>` : ''}
        ${idleDays ? `<span class="badge idle">idle ${idleDays}d</span>` : ''}
      </div>
    </div>
    ${cover ? `<img class="pc-thumb" data-photo="${cover}" alt="">` : ''}
  </div>`;
}

/* ---------------- views: detail ---------------- */
function viewDetail(p) {
  const dl = deadlineInfo(p);
  const ns = nextStep(p);
  const open = openSteps(p);
  const doneSteps = p.steps.filter((s) => s.done).sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
  const total = p.steps.length;
  const need = neededItems(p), have = p.items.filter((i) => i.have);
  const cost = need.reduce((n, i) => n + (parseFloat(i.cost) || 0) * (parseFloat(i.qty) || 1), 0);
  const hours = p.log.reduce((n, l) => n + (l.hours || 0), 0);

  let nextCard;
  if (ns) {
    const after = open[1];
    nextCard = `<section class="card next-card">
      <div class="lbl">Next step</div>
      <div class="next-text">${esc(ns.text)}</div>
      ${after ? `<div class="after">Then: ${esc(after.text)}</div>` : ''}
      ${need.length ? `<div class="needs">🛒 Still need ${plural(need.length, 'item')} for this project</div>` : ''}
      <div class="btn-row">
        <button type="button" class="btn green" data-act="stepDone" data-id="${p.id}" data-sid="${ns.id}">✓ Done</button>
        ${open.length > 1 ? `<button type="button" class="btn" data-act="stepLater" data-id="${p.id}" data-sid="${ns.id}">Do later</button>` : ''}
      </div>
      ${total ? `<div class="progress"><div class="bar"><i style="width:${((total - open.length) / total) * 100}%"></i></div>${total - open.length} of ${total} steps</div>` : ''}
    </section>`;
  } else if (total && p.status !== 'done') {
    nextCard = `<section class="card next-card"><div class="lbl">All steps done 🎉</div>
      <div class="next-text">Ready to wrap up?</div>
      <div class="btn-row"><button type="button" class="btn green" data-act="setStatus" data-id="${p.id}" data-s="done">Mark project done</button>
      <button type="button" class="btn" data-act="focusAddStep">Add a step</button></div></section>`;
  } else if (!total) {
    nextCard = `<section class="card next-card"><div class="lbl">Next step</div>
      <form class="add-form" data-submit="stepAdd" data-id="${p.id}"><input name="text" id="addStepTop" placeholder="What's the next thing to do?" enterkeyhint="done" autocomplete="off"><button class="add-btn">Add</button></form></section>`;
  } else nextCard = '';

  const stepRow = (s, i, arr) => `<li class="row ${s.done ? 'done' : ''}">
    <label class="check"><input type="checkbox" ${s.done ? 'checked' : ''} data-change="stepToggle" data-id="${p.id}" data-sid="${s.id}" aria-label="Done"><span></span></label>
    <input class="inline" value="${esc(s.text)}" data-change="stepText" data-id="${p.id}" data-sid="${s.id}" enterkeyhint="done" aria-label="Step">
    ${ui.editSteps && !s.done ? `<button type="button" class="mini" data-act="stepMove" data-dir="-1" data-id="${p.id}" data-sid="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
      <button type="button" class="mini" data-act="stepMove" data-dir="1" data-id="${p.id}" data-sid="${s.id}" ${i === arr.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>` : ''}
    ${ui.editSteps ? `<button type="button" class="mini del" data-act="stepDel" data-id="${p.id}" data-sid="${s.id}" aria-label="Delete">×</button>` : ''}
  </li>`;

  const itemRow = (it) => {
    const meta = [it.qty ? `×${esc(it.qty)}` : '', esc(it.store || ''), it.cost ? money(parseFloat(it.cost)) : ''].filter(Boolean).join(' · ');
    return `<li class="row ${it.have ? 'done' : ''}">
    <label class="check green"><input type="checkbox" ${it.have ? 'checked' : ''} data-change="itemHave" data-id="${p.id}" data-iid="${it.id}" aria-label="Have it"><span></span></label>
    <div class="grow">
      <input class="inline" value="${esc(it.name)}" data-change="itemField" data-f="name" data-id="${p.id}" data-iid="${it.id}" enterkeyhint="done" aria-label="Item">
      ${ui.editItems ? `<div class="item-edit">
          <select data-change="itemField" data-f="type" data-id="${p.id}" data-iid="${it.id}"><option value="material" ${it.type !== 'tool' ? 'selected' : ''}>Material</option><option value="tool" ${it.type === 'tool' ? 'selected' : ''}>Tool</option></select>
          <input placeholder="Qty" value="${esc(it.qty || '')}" data-change="itemField" data-f="qty" data-id="${p.id}" data-iid="${it.id}">
          <input placeholder="$ each" inputmode="decimal" value="${esc(it.cost || '')}" data-change="itemField" data-f="cost" data-id="${p.id}" data-iid="${it.id}">
          <input placeholder="Store" value="${esc(it.store || '')}" data-change="itemField" data-f="store" data-id="${p.id}" data-iid="${it.id}" list="stores">
        </div>` : meta ? `<div class="row-meta">${meta}</div>` : ''}
    </div>
    <span class="tag ${it.type === 'tool' ? 'tool' : 'material'}">${it.type === 'tool' ? 'Tool' : 'Mat'}</span>
    ${ui.editItems ? `<button type="button" class="mini del" data-act="itemDel" data-id="${p.id}" data-iid="${it.id}" aria-label="Delete">×</button>` : ''}
  </li>`;
  };
  const stores = [...new Set(state.projects.flatMap((x) => x.items.map((i) => i.store)).filter(Boolean))];
  const logs = ui.showAllLog ? p.log : p.log.slice(0, 6);

  return `
  <header class="topbar"><a href="#/"><span class="back-chev">‹</span> Projects</a><span class="tb-title"></span>
    <button type="button" class="tb-btn right" data-act="projMenu" data-id="${p.id}" aria-label="More"><span class="icon-btn">${ICON.more}</span></button></header>
  <div class="detail-head" style="--c:${p.color}">
    <div class="dh-cat"><span class="dot"></span>${esc(p.category || 'Project')} · <span class="prio ${p.priority}"></span> ${PRIORITIES[p.priority]} priority</div>
    <h1>${esc(p.name)}</h1>
    ${p.desc ? `<p class="desc">${esc(p.desc)}</p>` : ''}
    <div class="dh-badges">
      ${dl ? `<span class="badge ${dl.cls}">${dl.text}</span>` : ''}
      ${p.status === 'done' ? `<span class="badge done">✓ Completed ${p.completedAt ? fmtDate(ymd(new Date(p.completedAt)), { weekday: false }) : ''}</span>` : ''}
      ${isIdle(p) ? `<span class="badge idle">Idle ${daysSince(p.lastWorked || p.created)} days</span>` : ''}
    </div>
  </div>
  <div class="seg status-seg" role="group" aria-label="Status">${Object.entries(STATUSES).map(([k, l]) => `<button type="button" class="${p.status === k ? 'on' : ''}" data-act="setStatus" data-id="${p.id}" data-s="${k}">${l}</button>`).join('')}</div>
  ${p.status === 'waiting' ? `<div class="waiting-box">⏳<input class="waiting-input" placeholder="Waiting on… (parts, paint drying, a reply)" value="${esc(p.waitingOn || '')}" data-change="waitingOn" data-id="${p.id}" enterkeyhint="done"></div>` : ''}
  <div style="--c:${p.color}">${nextCard}</div>

  <section class="card">
    <div class="field-row"><span class="k">Deadline</span><span class="v">
      ${dl ? `<span class="countdown">${dl.n < 0 ? `${-dl.n}d late` : dl.n === 0 ? 'today' : `in ${dl.n}d`}</span>` : ''}
      <input type="date" value="${p.deadline || ''}" data-change="deadline" data-id="${p.id}" aria-label="Deadline"></span></div>
    ${p.deadline ? `<div class="field-row"><button type="button" class="text-btn" data-act="icsOne" data-id="${p.id}">Add deadline to Calendar</button><button type="button" class="text-btn" style="color:var(--red)" data-act="clearDeadline" data-id="${p.id}">Clear</button></div>` : ''}
  </section>

  <section class="card">
    <div class="sec-head"><h2>Steps <small>${total ? `${total - open.length}/${total}` : ''}</small></h2>
      ${total ? `<button type="button" class="text-btn" data-act="toggleEditSteps">${ui.editSteps ? 'Done' : 'Edit'}</button>` : ''}</div>
    <ul class="rows">${open.map(stepRow).join('') || (total ? '' : '<li class="empty-note">Break the project into small, concrete steps.</li>')}</ul>
    <form class="add-form" data-submit="stepAdd" data-id="${p.id}"><input name="text" id="addStep" placeholder="Add a step" enterkeyhint="done" autocomplete="off"><button class="add-btn">Add</button></form>
    ${doneSteps.length ? `<button type="button" class="text-btn" style="font-size:15px;margin-top:6px" data-act="toggleShowDone">${ui.showDone ? 'Hide' : 'Show'} ${plural(doneSteps.length, 'completed step')}</button>
      ${ui.showDone ? `<ul class="rows">${doneSteps.map(stepRow).join('')}</ul>` : ''}` : ''}
  </section>

  <section class="card">
    <div class="sec-head"><h2>Tools & Materials</h2>
      ${p.items.length ? `<button type="button" class="text-btn" data-act="toggleEditItems">${ui.editItems ? 'Done' : 'Edit'}</button>` : ''}</div>
    ${p.items.length ? `<div class="row-meta">${need.length ? `${need.length} still needed${cost ? ` · ~${money(cost)}` : ''}` : 'You have everything ✓'}</div>` : ''}
    ${need.length ? `<div class="subhead">Need</div><ul class="rows">${need.map(itemRow).join('')}</ul>` : ''}
    ${have.length ? `<div class="subhead">Have</div><ul class="rows">${have.map(itemRow).join('')}</ul>` : ''}
    ${!p.items.length ? '<div class="empty-note">List what you need to buy, borrow or find before you can continue.</div>' : ''}
    <form class="add-form" data-submit="itemAdd" data-id="${p.id}"><input name="name" id="addItem" placeholder="${ui.itemType === 'tool' ? 'Add tool' : 'Add material'}" enterkeyhint="done" autocomplete="off">
      <div class="seg small" style="flex:none"><button type="button" class="${ui.itemType === 'material' ? 'on' : ''}" data-act="itemType" data-t="material">Mat</button><button type="button" class="${ui.itemType === 'tool' ? 'on' : ''}" data-act="itemType" data-t="tool">Tool</button></div>
      <button class="add-btn">Add</button></form>
    <datalist id="stores">${stores.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
  </section>

  <section class="card">
    <div class="sec-head"><h2>Photos <small>${p.photos.length || ''}</small></h2></div>
    <div class="photos">
      ${p.photos.map((id) => `<div class="ph" data-act="photoOpen" data-id="${p.id}" data-pid="${id}"><img data-photo="${id}" alt="Project photo">${(p.cover || p.photos[0]) === id ? '<span class="cover-mark">Cover</span>' : ''}</div>`).join('')}
      <label class="photo-add" aria-label="Add photo">＋<input type="file" accept="image/*" multiple class="vh-input" data-change="photoAdd" data-id="${p.id}"></label>
    </div>
  </section>

  <section class="card">
    <div class="sec-head"><h2>Notes</h2></div>
    <textarea class="notes" placeholder="Measurements, settings, links, ideas…" data-input="notes" data-id="${p.id}">${esc(p.notes || '')}</textarea>
  </section>

  <section class="card">
    <div class="sec-head"><h2>Work log <small>${hours ? `${+hours.toFixed(2)} hrs total` : ''}</small></h2></div>
    <form class="add-form" data-submit="logAdd" data-id="${p.id}"><input name="text" placeholder="What did you work on?" enterkeyhint="done" autocomplete="off"><input name="hours" class="hrs" placeholder="hrs" inputmode="decimal" autocomplete="off"><button class="add-btn">Log</button></form>
    <ul class="rows" style="margin-top:6px">${logs.map((l) => `<li class="row log-entry">
      <span class="when">${relDate(l.at)}</span>
      <span class="row-text">${l.kind === 'step' ? '✓ ' : l.kind === 'status' ? '• ' : ''}${esc(l.text)}</span>
      ${l.hours ? `<span class="hrs-tag">${+l.hours}h</span>` : ''}
      <button type="button" class="mini del" data-act="logDel" data-id="${p.id}" data-lid="${l.id}" aria-label="Delete entry">×</button></li>`).join('')}</ul>
    ${p.log.length > 6 ? `<button type="button" class="text-btn" style="font-size:15px" data-act="toggleLog">${ui.showAllLog ? 'Show less' : `Show all ${p.log.length}`}</button>` : ''}
  </section>

  <div class="meta">Started ${fmtDate(ymd(new Date(p.created)))}${p.lastWorked ? ` · Last worked ${relDate(p.lastWorked).toLowerCase()}` : ''}</div>`;
}

/* ---------------- views: edit ---------------- */
function viewEdit(p) {
  const isNew = !p;
  p = p || { name: '', category: '', desc: '', color: COLORS[Math.floor(Math.random() * COLORS.length)], priority: 'med', status: 'active', deadline: '', waitingOn: '' };
  const cats = [...new Set(state.projects.map((x) => x.category).filter(Boolean))];
  const radios = (name, obj, cur) => Object.entries(obj).map(([k, l]) => `<label><input type="radio" name="${name}" value="${k}" ${cur === k ? 'checked' : ''}>${l}</label>`).join('');
  return `
  <header class="topbar"><a href="${isNew ? '#/' : `#/p/${p.id}`}" data-act="cancelEdit" data-href="${isNew ? '#/' : `#/p/${p.id}`}">Cancel</a><span class="tb-title">${isNew ? 'New Project' : 'Edit Project'}</span>
    <button type="submit" form="pform" class="tb-btn right tb-save">Save</button></header>
  <form id="pform" data-submit="saveProject" data-id="${isNew ? '' : p.id}" style="margin-top:8px">
    <div class="card form">
      <label class="field"><span>Name</span><input name="name" required value="${esc(p.name)}" placeholder="e.g. Garage shelving" autocomplete="off"></label>
      <label class="field"><span>Category</span><input name="category" list="cats" value="${esc(p.category || '')}" placeholder="3D printing, Woodworking, Home, Car…" autocomplete="off">
        <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      <label class="field"><span>Description / goal</span><textarea name="desc" rows="2" placeholder="What does done look like?">${esc(p.desc || '')}</textarea></label>
    </div>
    <div class="card form">
      <div class="field"><span>Color</span><div class="swatches">${COLORS.map((c) => `<label style="--sw:${c}"><input type="radio" name="color" value="${c}" ${p.color === c ? 'checked' : ''} aria-label="${c}"></label>`).join('')}</div></div>
      <div class="field"><span>Priority</span><div class="seg">${radios('priority', PRIORITIES, p.priority)}</div></div>
      <div class="field"><span>Status</span><div class="seg">${radios('status', STATUSES, p.status)}</div></div>
      <label class="field"><span>Deadline (optional)</span><input type="date" name="deadline" value="${p.deadline || ''}"></label>
      <label class="field"><span>Waiting on (optional)</span><input name="waitingOn" value="${esc(p.waitingOn || '')}" placeholder="Parts shipping, glue curing…" autocomplete="off"></label>
    </div>
    ${isNew ? `<div class="card form">
      <label class="field"><span>Steps — one per line, in order</span><textarea name="steps" rows="5" placeholder="Measure the wall\nBuy lumber\nCut boards\nAssemble & finish"></textarea></label>
      <label class="field"><span>Materials needed — one per line</span><textarea name="materials" rows="3" placeholder="4x 2×4 boards\nWood screws\nStain"></textarea></label>
      <label class="field"><span>Tools needed — one per line</span><textarea name="tools" rows="2" placeholder="Miter saw\nDrill"></textarea></label>
    </div><p class="hint">Tip: start a line with a quantity like “3x” and it'll be saved as the quantity.</p>` : ''}
    <button type="submit" class="btn primary block">${isNew ? 'Create project' : 'Save changes'}</button>
  </form>`;
}

/* ---------------- views: shopping ---------------- */
function viewShop() {
  const g = state.settings.shopGroup;
  const rows = [];
  for (const p of state.projects) {
    if (p.status === 'done') continue;
    for (const it of p.items) if (!it.have || ui.shopChecked.has(it.id)) rows.push({ p, it });
  }
  const remaining = rows.filter((r) => !r.it.have);
  const cost = remaining.reduce((n, { it }) => n + (parseFloat(it.cost) || 0) * (parseFloat(it.qty) || 1), 0);
  const head = `<header class="large"><h1>Shopping</h1>${remaining.length ? `<button type="button" class="icon-btn" data-act="shareShop" aria-label="Share list">${ICON.share}</button>` : ''}</header>`;
  if (!rows.length) {
    return `${head}<div class="empty"><div class="big">🧰</div><h2>Nothing to get</h2><p>Tools and materials you still need from your open projects show up here, ready for the hardware store.</p></div>`;
  }
  const groups = new Map();
  const keyOf = ({ p, it }) => (g === 'store' ? (it.store || 'Anywhere') : g === 'type' ? (it.type === 'tool' ? 'Tools' : 'Materials') : p.id);
  for (const r of rows) { const k = keyOf(r); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const keys = [...groups.keys()];
  if (g === 'store') keys.sort((a, b) => (a === 'Anywhere') - (b === 'Anywhere') || a.localeCompare(b));
  const html = keys.map((k) => {
    const list = groups.get(k);
    const title = g === 'project'
      ? `<span class="dot"></span><a href="#/p/${list[0].p.id}">${esc(list[0].p.name)}</a>`
      : esc(k);
    return `<section class="card shop-group" style="--c:${g === 'project' ? list[0].p.color : 'var(--accent)'}"><h3>${title}</h3><ul class="rows">
      ${list.map(({ p, it }) => {
        const meta = [g !== 'project' ? esc(p.name) : '', g !== 'store' && it.store ? esc(it.store) : '', it.cost ? money(parseFloat(it.cost)) : ''].filter(Boolean).join(' · ');
        return `<li class="row ${it.have ? 'done' : ''}">
        <label class="check green"><input type="checkbox" ${it.have ? 'checked' : ''} data-change="shopToggle" data-id="${p.id}" data-iid="${it.id}" aria-label="Got it"><span></span></label>
        <div class="row-text"><div>${esc(it.name)}${it.qty ? ` <span class="muted">×${esc(it.qty)}</span>` : ''}</div>${meta ? `<div class="row-meta">${meta}</div>` : ''}</div>
        <span class="tag ${it.type === 'tool' ? 'tool' : 'material'}">${it.type === 'tool' ? 'Tool' : 'Mat'}</span></li>`;
      }).join('')}</ul></section>`;
  }).join('');
  return `${head}
    <div class="seg" role="group" aria-label="Group by">${[['project', 'By project'], ['store', 'By store'], ['type', 'By type']].map(([k, l]) => `<button type="button" class="${g === k ? 'on' : ''}" data-act="shopGroup" data-g="${k}">${l}</button>`).join('')}</div>
    <div class="summary">${plural(remaining.length, 'item')} to get${cost ? ` · est. ${money(cost)}` : ''}. Check items off as you buy them.</div>
    ${html}`;
}

/* ---------------- views: upcoming ---------------- */
function viewUpcoming() {
  const open = state.projects.filter((p) => p.status !== 'done');
  const withD = open.filter((p) => p.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline));
  const noD = open.length - withD.length;
  const head = `<header class="large"><h1>Upcoming</h1>${withD.length ? `<button type="button" class="icon-btn" data-act="icsAll" aria-label="Add all to Calendar">${ICON.cal}</button>` : ''}</header>`;
  if (!withD.length) {
    return `${head}<div class="empty"><div class="big">📅</div><h2>No deadlines</h2><p>Give a project a deadline and it shows up here with a countdown.${noD ? ` You have ${plural(noD, 'open project')} without one.` : ''}</p></div>`;
  }
  const buckets = [
    ['Overdue', (n) => n < 0], ['This week', (n) => n >= 0 && n <= 7],
    ['Next 30 days', (n) => n > 7 && n <= 30], ['Later', (n) => n > 30],
  ];
  const row = (p) => {
    const d = parseYmd(p.deadline), dl = deadlineInfo(p), ns = nextStep(p);
    const left = openSteps(p).length;
    return `<li class="row up-row" data-act="open" data-id="${p.id}">
      <div class="date-block"><div class="m">${d.toLocaleDateString(undefined, { month: 'short' })}</div><div class="d">${d.getDate()}</div></div>
      <div class="row-text"><b>${esc(p.name)}</b><div class="row-meta">${p.status === 'waiting' ? `⏳ Waiting on ${esc(p.waitingOn || '…')}` : ns ? `Next: ${esc(ns.text)}` : 'No open steps'}${left ? ` · ${plural(left, 'step')} left` : ''}</div></div>
      <span class="badge ${dl.cls}">${dl.text}</span></li>`;
  };
  return `${head}
    ${buckets.map(([title, test]) => {
      const list = withD.filter((p) => test(daysUntil(p.deadline)));
      return list.length ? `<div class="section-title">${title}</div><section class="card" style="padding-top:4px;padding-bottom:4px"><ul class="rows">${list.map(row).join('')}</ul></section>` : '';
    }).join('')}
    ${noD ? `<p class="summary">${plural(noD, 'open project')} without a deadline.</p>` : ''}
    <p class="summary">Tap the calendar button to add these deadlines (with a reminder the morning before) to your iPhone Calendar.</p>`;
}

/* ---------------- views: settings ---------------- */
function viewSettings() {
  const s = state.settings;
  const badgeSupported = 'setAppBadge' in navigator;
  return `<header class="large"><h1>Settings</h1></header>
  <div class="section-title">Appearance</div>
  <section class="card" style="padding-top:2px;padding-bottom:2px">
    <div class="set-row"><span>Theme</span><div class="seg small">${[['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']].map(([k, l]) => `<button type="button" class="${s.theme === k ? 'on' : ''}" data-act="theme" data-t="${k}">${l}</button>`).join('')}</div></div>
    <div class="set-row"><span>Flag projects idle after</span><select data-change="staleDays">${[[0, 'Never'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [60, '60 days']].map(([v, l]) => `<option value="${v}" ${s.staleDays === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${badgeSupported ? `<div class="set-row"><span>App icon badge<br><small>Count of overdue & due-today projects</small></span><label class="switch"><input type="checkbox" ${s.badge ? 'checked' : ''} data-change="badge"><span></span></label></div>` : ''}
  </section>

  <div class="section-title">Backup</div>
  <section class="card" style="padding-top:2px;padding-bottom:2px">
    <button type="button" class="set-row" data-act="exportBackup"><span>Export backup</span><small>${s.lastBackup ? `Last: ${relDate(s.lastBackup)}` : 'Never'}</small></button>
    <label class="set-row" style="color:var(--accent);cursor:pointer"><span>Import backup…</span><input type="file" accept="application/json,.json" data-change="importBackup" class="vh-input"></label>
    <button type="button" class="set-row" data-act="icsAll"><span>Add all deadlines to Calendar</span></button>
  </section>
  <p class="set-note">Everything is stored only on this device — nothing is uploaded. Export a backup to Files or iCloud Drive now and then; import it to restore or to move to a new phone.</p>

  <div class="section-title">Data</div>
  <section class="card" style="padding-top:2px;padding-bottom:2px">
    <button type="button" class="set-row" data-act="loadExample"><span>Add example project</span></button>
    <button type="button" class="set-row danger" data-act="clearDone"><span>Delete completed projects</span></button>
    <button type="button" class="set-row danger" data-act="eraseAll"><span>Erase all data</span></button>
  </section>

  ${!isStandalone() ? `<div class="section-title">Install</div><section class="card"><b>Add Workbench to your Home Screen</b>
    <ol class="steps-help"><li>Open this page in <b>Safari</b></li><li>Tap the <b>Share</b> button</li><li>Choose <b>Add to Home Screen</b></li></ol>
    <p class="set-note" style="margin:8px 0 0">Installed, it runs full-screen, works offline, and iOS won't clear its data.</p></section>` : ''}

  <div class="section-title">About</div>
  <section class="card" style="padding-top:2px;padding-bottom:2px">
    <div class="set-row"><span>Version</span><small>${APP_VERSION}</small></div>
    <div class="set-row"><span>Projects</span><small>${state.projects.length}</small></div>
    <div class="set-row"><span>Storage used</span><small id="storageInfo">…</small></div>
  </section>`;
}
async function fillStorageInfo() {
  const el = $('#storageInfo'); if (!el) return;
  try {
    const est = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    el.textContent = `${(est.usage / 1048576).toFixed(1)} MB${persisted ? ' · protected' : ''}`;
  } catch (e) { el.textContent = '—'; }
}

/* ---------------- calendar export ---------------- */
function icsEscape(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function icsFold(line) {
  const out = []; let l = line;
  while (l.length > 74) { out.push(l.slice(0, 74)); l = ' ' + l.slice(74); }
  out.push(l); return out.join('\r\n');
}
function buildICS(projects) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Workbench//Project Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const p of projects) {
    const start = p.deadline.replace(/-/g, '');
    const e = parseYmd(p.deadline); e.setDate(e.getDate() + 1);
    const ns = nextStep(p), need = neededItems(p);
    const desc = [p.desc, ns ? `Next step: ${ns.text}` : '', need.length ? `Still need: ${need.map((i) => i.name).join(', ')}` : ''].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:${p.id}@workbench`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${ymd(e).replace(/-/g, '')}`,
      `SUMMARY:${icsEscape(`Due: ${p.name}`)}`, `DESCRIPTION:${icsEscape(desc)}`, 'TRANSP:TRANSPARENT',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(`${p.name} is due tomorrow`)}`, 'TRIGGER:-PT15H', 'END:VALARM',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n');
}
async function exportICS(projects, name) {
  if (!projects.length) return toast('No deadlines to export');
  const ics = buildICS(projects);
  if (isIOS()) {
    // Safari hands text/calendar data to the Calendar app ("Add All").
    location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    return;
  }
  await shareOrDownload(new Blob([ics], { type: 'text/calendar' }), `${name}.ics`, 'Deadlines');
}

/* ---------------- backup ---------------- */
async function exportBackup() {
  let photos = [];
  const ids = new Set(state.projects.flatMap((p) => p.photos));
  if (ids.size) {
    const recs = (await PhotoDB.all().catch(() => [])).filter((r) => ids.has(r.id));
    const mb = recs.reduce((n, r) => n + r.blob.size + (r.thumb?.size || 0), 0) * 1.37 / 1048576;
    const choice = await sheet({
      title: 'Export backup', message: `Your projects have ${plural(recs.length, 'photo')}.`,
      actions: [{ label: `Include photos (~${mb.toFixed(1)} MB)`, value: 'all' }, { label: 'Projects only (small file)', value: 'none' }],
    });
    if (!choice) return;
    if (choice === 'all') {
      photos = await Promise.all(recs.map(async (r) => ({ id: r.id, projectId: r.projectId, created: r.created, data: await blobToDataURL(r.blob), thumb: r.thumb ? await blobToDataURL(r.thumb) : null })));
    }
  }
  const data = { app: 'workbench', version: 1, exported: now(), projects: state.projects, settings: state.settings, photos };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const ok = await shareOrDownload(blob, `workbench-backup-${todayStr()}.json`, 'Workbench backup');
  if (ok) { state.settings.lastBackup = now(); save(); render(); toast('Backup exported'); }
}
async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { return toast('That file isn’t a valid backup'); }
  if (!data || !Array.isArray(data.projects)) return toast('That file isn’t a Workbench backup');
  const mode = await sheet({
    title: 'Import backup',
    message: `${plural(data.projects.length, 'project')}${data.exported ? ` · saved ${new Date(data.exported).toLocaleDateString()}` : ''}`,
    actions: [{ label: 'Merge with current projects', value: 'merge' }, { label: 'Replace everything', value: 'replace', style: 'danger' }],
  });
  if (!mode) return;
  snapshot();
  const incoming = data.projects.map(normalize);
  if (mode === 'replace') state.projects = incoming;
  else {
    for (const p of incoming) {
      const ex = getP(p.id);
      if (!ex) state.projects.push(p);
      else if ((p.updated || '') > (ex.updated || '')) Object.assign(ex, p);
    }
  }
  for (const ph of data.photos || []) {
    try { await PhotoDB.put({ id: ph.id, projectId: ph.projectId, created: ph.created, blob: dataURLToBlob(ph.data), thumb: ph.thumb ? dataURLToBlob(ph.thumb) : null }); }
    catch (e) { /* skip bad photo */ }
  }
  save(); go('#/'); render();
  undoToast(`Imported ${plural(incoming.length, 'project')}`);
}

/* ---------------- example ---------------- */
function exampleProject() {
  const mk = (text, done = false) => ({ id: uid(), text, done, doneAt: done ? now() : null });
  const it = (name, type, extra = {}) => ({ id: uid(), name, type, have: false, qty: '', cost: '', store: '', ...extra });
  const p = normalize({
    id: uid(), name: 'Garden bench', category: 'Woodworking', color: '#34c759', priority: 'high', status: 'active',
    desc: 'Cedar bench for the back patio, seats two.', deadline: addDays(19), created: now(), lastWorked: now(),
    steps: [mk('Sketch design & cut list', true), mk('Buy cedar boards'), mk('Cut legs and slats to length'), mk('Dry-fit and sand'), mk('Assemble with screws & glue'), mk('Apply two coats of sealer')],
    items: [
      it('Cedar 2×4 (8 ft)', 'material', { qty: '4', cost: '12', store: 'Home Depot' }),
      it('Exterior wood screws', 'material', { qty: '1 box', cost: '9', store: 'Home Depot' }),
      it('Outdoor wood sealer', 'material', { cost: '24', store: 'Lowe’s' }),
      it('Wood glue (Titebond III)', 'material', { have: true }),
      it('Miter saw', 'tool', { have: true }),
      it('Pocket-hole jig', 'tool', { store: 'Borrow from Mike' }),
    ],
    notes: 'Seat height 18". Overall length 48".',
  });
  addLog(p, 'Finished sketch and cut list', 'note', 1);
  return p;
}

/* ---------------- actions ---------------- */
function findStep(d) { const p = getP(d.id); return [p, p?.steps.find((s) => s.id === d.sid)]; }
function findItem(d) { const p = getP(d.id); return [p, p?.items.find((i) => i.id === d.iid)]; }
function parseQty(text) {
  const m = text.match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s+(.+)$/i);
  return m ? { qty: m[1], name: m[2].trim() } : { qty: '', name: text.trim() };
}
function completeStep(p, s) {
  snapshot();
  s.done = true; s.doneAt = now();
  addLog(p, s.text, 'step');
  touch(p, true); save(); render();
  const ns = nextStep(p);
  if (ns) undoToast(`Done! Next: ${ns.text}`);
  else toast('All steps done 🎉', { label: 'Finish project', fn: () => setStatus(p, 'done') });
}
function setStatus(p, s) {
  if (p.status === s) return;
  snapshot();
  p.status = s;
  if (s === 'done') p.completedAt = now(); else p.completedAt = null;
  addLog(p, `Status → ${STATUSES[s]}`, 'status');
  touch(p, s === 'done');
  if (s === 'waiting' && !p.waitingOn) ui.focus = '.waiting-input';
  save(); render();
  if (s === 'done') undoToast(`“${p.name}” complete 🎉`);
}

const ACTIONS = {
  open: (d) => go(`#/p/${d.id}`),
  filter: (d) => { state.settings.filter = state.settings.filter === d.f && d.f !== 'open' ? 'open' : d.f; save(); render(); },
  cancelEdit: (d) => { clearDraft(); go(d.href); },
  resumeDraft: () => { const dr = liveDraft(); if (dr) go(`#/${dr.route}`); },
  discardDraft: () => { clearDraft(); render(); },
  dismissInstall: () => { state.settings.installDismissed = true; save(); render(); },
  loadExample: () => { const p = exampleProject(); state.projects.push(p); save(); go(`#/p/${p.id}`); toast('Example project added'); },
  stepDone: (d) => { const [p, s] = findStep(d); if (s) completeStep(p, s); },
  stepLater: (d) => {
    const [p, s] = findStep(d); if (!s) return;
    p.steps.splice(p.steps.indexOf(s), 1); p.steps.push(s); touch(p); save(); render();
    toast(`Moved to the end`);
  },
  stepMove: (d) => {
    const [p, s] = findStep(d); if (!s) return;
    const open = openSteps(p); const i = open.indexOf(s); const other = open[i + Number(d.dir)];
    if (!other) return;
    const a = p.steps.indexOf(s), b = p.steps.indexOf(other);
    [p.steps[a], p.steps[b]] = [p.steps[b], p.steps[a]];
    touch(p); save(); render();
  },
  stepDel: (d) => { const [p, s] = findStep(d); if (!s) return; snapshot(); p.steps = p.steps.filter((x) => x !== s); touch(p); save(); render(); undoToast('Step deleted'); },
  focusAddStep: () => { const el = $('#addStep'); el?.scrollIntoView({ block: 'center' }); el?.focus(); },
  toggleEditSteps: () => { ui.editSteps = !ui.editSteps; render(); },
  toggleEditItems: () => { ui.editItems = !ui.editItems; render(); },
  toggleShowDone: () => { ui.showDone = !ui.showDone; render(); },
  toggleLog: () => { ui.showAllLog = !ui.showAllLog; render(); },
  itemType: (d) => { ui.itemType = d.t; const v = $('#addItem')?.value || ''; render(); const el = $('#addItem'); if (el) { el.value = v; el.focus(); } },
  itemDel: (d) => { const [p, it] = findItem(d); if (!it) return; snapshot(); p.items = p.items.filter((x) => x !== it); touch(p); save(); render(); undoToast('Item deleted'); },
  setStatus: (d) => setStatus(getP(d.id), d.s),
  clearDeadline: (d) => { const p = getP(d.id); p.deadline = ''; touch(p); save(); render(); },
  icsOne: (d) => { const p = getP(d.id); exportICS([p], p.name.replace(/[^\w-]+/g, '-')); },
  icsAll: () => exportICS(state.projects.filter((p) => p.deadline && p.status !== 'done'), 'workbench-deadlines'),
  logDel: (d) => { const p = getP(d.id); snapshot(); p.log = p.log.filter((l) => l.id !== d.lid); save(); render(); undoToast('Entry deleted'); },
  photoOpen: (d) => openLightbox(getP(d.id), d.pid),
  shopGroup: (d) => { state.settings.shopGroup = d.g; save(); render(); },
  shareShop: () => {
    const g = new Map();
    for (const p of state.projects) {
      if (p.status === 'done') continue;
      for (const it of neededItems(p)) {
        const k = it.store || 'Anywhere';
        if (!g.has(k)) g.set(k, []);
        g.get(k).push(`☐ ${it.name}${it.qty ? ` ×${it.qty}` : ''} (${p.name})`);
      }
    }
    shareText([...g].map(([k, v]) => `${k}:\n${v.join('\n')}`).join('\n\n'), 'Shopping list');
  },
  theme: (d) => { state.settings.theme = d.t; applyTheme(); save(); render(); },
  exportBackup: () => exportBackup(),
  clearDone: async () => {
    const n = state.projects.filter((p) => p.status === 'done').length;
    if (!n) return toast('No completed projects');
    const ok = await sheet({ title: `Delete ${plural(n, 'completed project')}?`, actions: [{ label: 'Delete', value: true, style: 'danger' }] });
    if (!ok) return;
    snapshot(); state.projects = state.projects.filter((p) => p.status !== 'done'); save(); render(); undoToast(`Deleted ${plural(n, 'project')}`);
  },
  eraseAll: async () => {
    const ok = await sheet({ title: 'Erase all data?', message: 'This deletes every project and photo on this device. Export a backup first if you might want them.', actions: [{ label: 'Erase everything', value: true, style: 'danger' }] });
    if (!ok) return;
    state = blankState(); undoSnap = null; save(); await PhotoDB.clear().catch(() => {}); applyTheme(); go('#/'); render(); toast('All data erased');
  },
  projMenu: async (d) => {
    const p = getP(d.id);
    const choice = await sheet({
      title: p.name,
      actions: [
        { label: 'Edit details', value: 'edit' }, { label: 'Share summary', value: 'share' },
        { label: 'Duplicate', value: 'dup' }, { label: 'Delete project', value: 'del', style: 'danger' },
      ],
    });
    if (choice === 'edit') go(`#/edit/${p.id}`);
    if (choice === 'share') {
      const ns = nextStep(p), need = neededItems(p);
      shareText([
        p.name, p.desc, p.deadline ? `Due: ${fmtDate(p.deadline)}` : '',
        ns ? `Next step: ${ns.text}` : '',
        openSteps(p).length > 1 ? `Remaining steps:\n${openSteps(p).map((s) => `• ${s.text}`).join('\n')}` : '',
        need.length ? `Still need:\n${need.map((i) => `• ${i.name}${i.qty ? ` ×${i.qty}` : ''}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n'), p.name);
    }
    if (choice === 'dup') {
      const c = normalize({
        ...JSON.parse(JSON.stringify(p)), id: uid(), name: `${p.name} (copy)`, created: now(), updated: now(),
        lastWorked: null, completedAt: null, status: 'active', log: [], photos: [], cover: null,
      });
      c.steps.forEach((s) => { s.id = uid(); s.done = false; s.doneAt = null; });
      c.items.forEach((i) => { i.id = uid(); if (i.type !== 'tool') i.have = false; });
      state.projects.push(c); save(); go(`#/p/${c.id}`); toast('Duplicated');
    }
    if (choice === 'del') {
      snapshot(); state.projects = state.projects.filter((x) => x !== p); save(); go('#/'); undoToast(`Deleted “${p.name}”`);
    }
  },
};

const CHANGES = {
  sort: (d, el) => { state.settings.sort = el.value; save(); renderCards(); },
  stepToggle: (d, el) => {
    const [p, s] = findStep(d); if (!s) return;
    if (el.checked) return completeStep(p, s);
    s.done = false; s.doneAt = null; touch(p); save(); render();
  },
  stepText: (d, el) => {
    const [p, s] = findStep(d); if (!s) return;
    const v = el.value.trim();
    if (!v) { el.value = s.text; return; }
    s.text = v; touch(p); save();
  },
  itemHave: (d, el) => { const [p, it] = findItem(d); if (!it) return; it.have = el.checked; touch(p); save(); render(); },
  itemField: (d, el) => {
    const [p, it] = findItem(d); if (!it) return;
    const v = el.value.trim();
    if (d.f === 'name' && !v) { el.value = it.name; return; }
    it[d.f] = d.f === 'cost' ? v.replace(/[^0-9.]/g, '') : v;
    touch(p); save();
    if (d.f === 'type') render();
  },
  waitingOn: (d, el) => { const p = getP(d.id); p.waitingOn = el.value.trim(); touch(p); save(); },
  deadline: (d, el) => { const p = getP(d.id); p.deadline = el.value; touch(p); save(); render(); },
  shopToggle: (d, el) => { const [p, it] = findItem(d); if (!it) return; it.have = el.checked; ui.shopChecked.add(it.id); touch(p); save(); render(); },
  staleDays: (d, el) => { state.settings.staleDays = Number(el.value); save(); },
  badge: async (d, el) => {
    if (el.checked && 'Notification' in window && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission().catch(() => 'denied');
      if (perm !== 'granted') { el.checked = false; return toast('Allow notifications to show the badge'); }
    }
    state.settings.badge = el.checked; save();
    if (!el.checked) navigator.clearAppBadge?.().catch(() => {});
  },
  importBackup: (d, el) => { const f = el.files[0]; el.value = ''; if (f) importBackup(f); },
  photoAdd: async (d, el) => {
    const p = getP(d.id); const files = [...el.files]; el.value = '';
    if (!files.length) return;
    toast(`Adding ${plural(files.length, 'photo')}…`);
    for (const f of files) {
      try {
        const img = await loadImage(f);
        const [blob, thumb] = await Promise.all([resizeTo(img, 1600, 0.82), resizeTo(img, 360, 0.75)]);
        const id = uid();
        await PhotoDB.put({ id, projectId: p.id, created: now(), blob, thumb });
        p.photos.push(id);
      } catch (e) { toast('Couldn’t read that image'); }
    }
    touch(p, true); save(); render();
  },
};

const SUBMITS = {
  stepAdd: (d, f) => {
    const p = getP(d.id); const text = f.text.value.trim(); if (!text) return;
    p.steps.push({ id: uid(), text, done: false, doneAt: null }); touch(p); save();
    ui.focus = f.text.id === 'addStepTop' ? '#addStep' : '#' + f.text.id;
    render();
  },
  itemAdd: (d, f) => {
    const p = getP(d.id); const raw = f.name.value.trim(); if (!raw) return;
    const { qty, name } = parseQty(raw);
    p.items.push({ id: uid(), name, type: ui.itemType, have: false, qty, cost: '', store: '' });
    touch(p); save(); ui.focus = '#addItem'; render();
  },
  logAdd: (d, f) => {
    const p = getP(d.id); const text = f.text.value.trim(); const hours = parseFloat(f.hours.value) || 0;
    if (!text && !hours) return;
    addLog(p, text || 'Worked on it', 'note', hours); touch(p, true); save(); render(); toast('Logged');
  },
  saveProject: (d, f) => {
    const fd = new FormData(f);
    const name = fd.get('name').trim(); if (!name) return;
    const fields = {
      name, category: fd.get('category').trim(), desc: fd.get('desc').trim(), color: fd.get('color') || COLORS[6],
      priority: fd.get('priority'), status: fd.get('status'), deadline: fd.get('deadline') || '', waitingOn: fd.get('waitingOn').trim(),
    };
    let p = d.id ? getP(d.id) : null;
    if (p) {
      if (p.status !== fields.status) {
        addLog(p, `Status → ${STATUSES[fields.status]}`, 'status');
        p.completedAt = fields.status === 'done' ? now() : null;
      }
      Object.assign(p, fields); touch(p);
    } else {
      const lines = (k) => (fd.get(k) || '').split('\n').map((s) => s.trim()).filter(Boolean);
      p = normalize({ id: uid(), ...fields, created: now(), updated: now(), lastWorked: null });
      p.steps = lines('steps').map((text) => ({ id: uid(), text, done: false, doneAt: null }));
      p.items = [...lines('materials').map((l) => ['material', l]), ...lines('tools').map((l) => ['tool', l])]
        .map(([type, l]) => ({ id: uid(), type, have: false, cost: '', store: '', ...parseQty(l) }));
      if (p.status === 'done') p.completedAt = now();
      state.projects.push(p);
    }
    clearDraft(); save(); location.replace(`#/p/${p.id}`);
  },
};

let notesTimer;
const INPUTS = {
  search: (d, el) => { ui.search = el.value; renderCards(); },
  notes: (d, el) => {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(() => { const p = getP(d.id); if (p) { p.notes = el.value; touch(p); save(); } }, 400);
  },
};

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a || a.disabled) return;
  const fn = ACTIONS[a.dataset.act];
  if (fn) { e.preventDefault(); e.stopPropagation(); fn(a.dataset, a, e); }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.form?.id === 'pform') saveDraft(el.form);
  if (el.dataset.change) CHANGES[el.dataset.change]?.(el.dataset, el, e);
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.form?.id === 'pform') saveDraft(el.form);
  if (el.dataset.input) INPUTS[el.dataset.input]?.(el.dataset, el, e);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-submit]');
  if (f) { e.preventDefault(); SUBMITS[f.dataset.submit]?.(f.dataset, f, e); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('inline')) { e.preventDefault(); e.target.blur(); }
  if (e.key === 'Enter' && e.target.classList?.contains('pcard')) go(`#/p/${e.target.dataset.id}`);
});
// Flush notes / form draft if the app is backgrounded mid-typing.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    const ta = $('textarea.notes');
    if (ta) { clearTimeout(notesTimer); const p = getP(ta.dataset.id); if (p && p.notes !== ta.value) { p.notes = ta.value; touch(p); save(); } }
    const f = $('#pform');
    if (f && readDraft()?.route === route().join('/')) saveDraft(f);
  } else if (!['new', 'edit'].includes(route()[0])) {
    render(); // refresh relative dates/countdowns when reopened (but never wipe a half-filled form)
  }
});

/* ---------------- lightbox ---------------- */
function openLightbox(p, pid) {
  const lb = $('#lightbox');
  const isCover = (p.cover || p.photos[0]) === pid;
  lb.innerHTML = `<div class="lb-img"><img data-photo="${pid}" data-size="full" alt=""></div>
    <div class="lb-bar"><button type="button" class="del" data-lb="del">Delete</button>
    ${isCover ? '<span></span>' : '<button type="button" data-lb="cover">Set as cover</button>'}
    <button type="button" data-lb="close"><b>Done</b></button></div>`;
  lb.hidden = false;
  hydratePhotos();
  lb.onclick = async (e) => {
    const b = e.target.closest('[data-lb]'); if (!b) return;
    if (b.dataset.lb === 'cover') { p.cover = pid; touch(p); save(); toast('Cover photo set'); }
    if (b.dataset.lb === 'del') {
      const ok = await sheet({ title: 'Delete this photo?', actions: [{ label: 'Delete photo', value: true, style: 'danger' }] });
      if (!ok) return;
      p.photos = p.photos.filter((x) => x !== pid);
      if (p.cover === pid) p.cover = null;
      touch(p); save(); PhotoDB.del(pid).catch(() => {});
    }
    lb.hidden = true; lb.innerHTML = ''; lb.onclick = null; render();
  };
}

/* ---------------- badges, theme, boot ---------------- */
function updateBadges() {
  const open = state.projects.filter((p) => p.status !== 'done');
  const urgent = open.filter((p) => p.deadline && daysUntil(p.deadline) <= 0).length;
  const need = open.reduce((n, p) => n + neededItems(p).length, 0);
  const bs = $('#badge-shop'), bc = $('#badge-cal');
  if (bs) { bs.textContent = need || ''; bs.style.background = 'var(--muted)'; }
  if (bc) bc.textContent = urgent || '';
  if (state.settings.badge && 'setAppBadge' in navigator) {
    (urgent ? navigator.setAppBadge(urgent) : navigator.clearAppBadge()).catch(() => {});
  }
}
function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function boot() {
  applyTheme();
  // If iOS closed the app while a form was half-filled, reopen straight into it.
  const draft = liveDraft();
  if (draft && !route().length && Date.now() - new Date(draft.at) < 2 * 3600000) location.replace(`#/${draft.route}`);
  render();
  navigator.storage?.persist?.().catch(() => {});
  // Remove photos whose project no longer exists (e.g. deleted in an earlier session).
  PhotoDB.keys().then((keys) => {
    const live = new Set(state.projects.flatMap((p) => p.photos));
    keys.filter((k) => !live.has(k)).forEach((k) => PhotoDB.del(k));
  }).catch(() => {});
  // Re-render at midnight so countdowns stay correct if the app stays open.
  const ms = new Date().setHours(24, 0, 5, 0) - Date.now();
  setTimeout(function tick() { render(); setTimeout(tick, 86400000); }, ms);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    let reloading = false, requested = false;
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new version is ready', { label: 'Update', fn: () => { requested = true; w.postMessage('skip'); } });
          }
        });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!requested || reloading) return;
      reloading = true; location.reload();
    });
  }
}
boot();
