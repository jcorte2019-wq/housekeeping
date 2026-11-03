// horario.js — Pestaña "Horario" (solo supervisor)
// Instalación: subir este archivo junto a index.html y agregar antes de </body>:
//   <script type="module" src="horario.js"></script>
//
// Los datos se guardan en su propio documento de Firebase (housekeeping/horario-aloft),
// así que "Reiniciar día" NO borra el personal ni los horarios.

import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, onSnapshot, setDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyDB4VRVq1TdQB6LjIjn8SkGB4mxpCCkr20",
  authDomain: "housekeeping-aloft.firebaseapp.com",
  projectId: "housekeeping-aloft",
  storageBucket: "housekeeping-aloft.firebasestorage.app",
  messagingSenderId: "706250496034",
  appId: "1:706250496034:web:5cddac6c1d086c15b7d27b"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(app);
const HZDOC = doc(db, 'housekeeping', 'horario-aloft');

// ── Constantes
const TOTAL_ROOMS = 116;
const POSITIONS = ['Housekeeper Supervisor', 'Inspector', 'Laundry Attendant', 'Public Areas', 'Room Attendant'];
const POS_ICON = {
  'Housekeeper Supervisor': '🧭', 'Inspector': '🔍', 'Laundry Attendant': '🧺',
  'Public Areas': '🛎️', 'Room Attendant': '🛏️'
};
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const SHEET = 'height:auto!important;max-height:88vh;display:block!important;overflow-y:auto;max-width:460px;width:100%;border-radius:16px!important';

// ── Estado
let hz = { staff: [], weeks: {} };
let week = sundayOf(new Date());   // domingo de la semana que se ve (YYYY-MM-DD)
let saveT = null;
let cellCtx = null;
let lastPos = 'Room Attendant';

// ── Utilidades
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function sundayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return iso(x); }
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); }
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = m => { if (window.toast) window.toast(m); };
const rid = () => Math.random().toString(36).slice(2, 10);
const has = v => v !== '' && v != null;
const num = v => { const x = Number(v); return has(v) && isFinite(x) ? x : 0; };

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'p' : 'a';
  const hh = h % 12 || 12;
  return m ? `${hh}:${pad(m)}${ap}` : `${hh}${ap}`;
}
function hrs(c) {
  if (!c || c.off || !c.s || !c.e) return 0;
  const [sh, sm] = c.s.split(':').map(Number), [eh, em] = c.e.split(':').map(Number);
  let m = (eh * 60 + em) - (sh * 60 + sm);
  if (m < 0) m += 1440;
  return m / 60;
}

// ── Ocupación = (cuartos en hotel + llegadas) / 116
function pct(o) {
  o = o || {};
  if (!has(o.inh) && !has(o.arr)) return null;
  return Math.round((num(o.inh) + num(o.arr)) / TOTAL_ROOMS * 1000) / 10;
}
function pctHTML(o) {
  const p = pct(o);
  if (p === null) return '<span class="hz-pct" style="background:#f1f5f9;color:#94a3b8">—</span>';
  const lv = p >= 95 ? ['#fff1f1', '#d63b3b'] : p >= 80 ? ['#fffbeb', '#c77b08'] : p >= 50 ? ['#ecfdf5', '#0d9467'] : ['#eff6ff', '#1d6fd4'];
  return `<span class="hz-pct" style="background:${lv[0]};color:${lv[1]}">${p}%</span>`;
}
function avgHTML(w) {
  const ps = [0, 1, 2, 3, 4, 5, 6].map(d => pct((w.occ || [])[d])).filter(p => p !== null);
  if (!ps.length) return '—';
  return (Math.round(ps.reduce((a, b) => a + b, 0) / ps.length * 10) / 10) + '%';
}

// ── Datos de la semana
function viewWeek() {
  const w = hz.weeks[week];
  return { occ: (w && w.occ) || [], shifts: (w && w.shifts) || {} };
}
function ensureWeek() {
  let w = hz.weeks[week];
  if (!w) w = hz.weeks[week] = { occ: [], shifts: {} };
  if (!Array.isArray(w.occ)) w.occ = [];
  for (let i = 0; i < 7; i++) if (!w.occ[i]) w.occ[i] = { inh: '', ref: '', dep: '', arr: '' };
  if (!w.shifts) w.shifts = {};
  return w;
}

// ── Guardado (documento propio, con retraso para no escribir en cada tecla)
function hzSave() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try {
      await setDoc(HZDOC, { staff: hz.staff, weeks: hz.weeks, updatedAt: Date.now() });
    } catch (e) {
      console.error(e);
      toast('⚠️ Error al guardar el horario');
    }
    saveT = null;
  }, 500);
}

// ── Estilos
function injectStyles() {
  const st = document.createElement('style');
  st.textContent = `
  .hz-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .hz-title{font-weight:800;font-size:1.05rem;margin-right:auto}
  .hz-wk{display:flex;align-items:center;gap:6px}
  .hz-nav{width:32px;height:32px;border-radius:8px;border:1.5px solid var(--bdr);background:white;cursor:pointer;font-size:1.1rem;line-height:1;color:var(--text)}
  .hz-label{font-size:.82rem;font-weight:700;min-width:150px;text-align:center}
  .hz-today-btn{height:32px;padding:0 10px;border-radius:8px;border:1.5px solid var(--bdr);background:white;cursor:pointer;font-size:.74rem;font-weight:700;color:var(--p)}
  .hz-wrap{overflow-x:auto;background:white;border:1px solid var(--bdr);border-radius:14px;box-shadow:var(--shadow-sm)}
  table.hz{border-collapse:separate;border-spacing:0;width:100%;min-width:660px;font-size:.78rem}
  .hz th,.hz td{padding:6px 4px;border-bottom:1px solid #f0f4f8;text-align:center;vertical-align:middle}
  .hz thead th{background:#f8fafc;font-size:.7rem;font-weight:700;color:var(--muted);line-height:1.25}
  .hz thead th.hz-today{background:var(--pl);color:var(--p2)}
  .hz .hz-name{position:sticky;left:0;background:white;text-align:left;padding-left:10px;min-width:108px;max-width:140px;font-weight:600;z-index:2;border-right:1px solid #f0f4f8}
  .hz thead .hz-name{background:#f8fafc;z-index:3}
  .hz .hz-sec td{background:#f1f6fa;font-size:.74rem;font-weight:800;color:var(--p2);text-align:left;padding:6px 10px}
  .hz-in{width:48px;padding:6px 2px;text-align:center;border:1.5px solid var(--bdr);border-radius:7px;font-size:.84rem;font-weight:600;font-family:inherit;color:var(--text);background:white;-moz-appearance:textfield}
  .hz-in::-webkit-outer-spin-button,.hz-in::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
  .hz-in:focus{outline:none;border-color:var(--p)}
  .hz-pct{display:inline-block;min-width:48px;padding:4px 6px;border-radius:8px;font-weight:800;font-size:.8rem}
  .hz-cell{display:block;width:100%;min-width:62px;min-height:38px;border:1.5px dashed #d5dde7;border-radius:8px;background:white;cursor:pointer;font-size:.7rem;font-weight:700;color:#94a3b8;padding:3px 2px;line-height:1.2;font-family:inherit}
  .hz-cell.on{border-style:solid;border-color:var(--p-light);background:var(--pl);color:var(--p2)}
  .hz-cell.off{border-style:solid;border-color:#e2e8f0;background:#f1f5f9;color:#94a3b8}
  .hz-h{font-weight:600;opacity:.75;font-size:.64rem}
  .hz-hrs{font-weight:700;color:var(--muted);font-size:.78rem}
  .hz-foot td{background:#f8fafc;font-weight:700;color:var(--muted)}
  .hz-foot .hz-name{background:#f8fafc}
  .hz-note{font-size:.72rem;color:var(--muted);margin-top:8px;line-height:1.5}
  .hz-chip{border:1.5px solid var(--bdr);background:white;border-radius:20px;padding:5px 11px;font-size:.76rem;font-weight:700;color:var(--p);cursor:pointer;font-family:inherit}
  .hz-time{width:100%;padding:10px;border:1.5px solid var(--bdr);border-radius:8px;font-size:.92rem;font-family:inherit;color:var(--text);background:white}
  .hz-srow{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f0f4f8}
  `;
  document.head.appendChild(st);
}

// ── Página principal
function hzRender() {
  const el = $('tab-horario');
  if (!el) return;
  const w = viewWeek();
  const days = [0, 1, 2, 3, 4, 5, 6];
  const todayISO = iso(new Date());
  const d0 = parseISO(week), d6 = parseISO(addDays(week, 6));
  const label = `${d0.getDate()} ${MES[d0.getMonth()]} – ${d6.getDate()} ${MES[d6.getMonth()]} ${d6.getFullYear()}`;
  const o = d => (w.occ && w.occ[d]) || {};

  const head = days.map(d => {
    const dt = parseISO(addDays(week, d));
    const t = iso(dt) === todayISO;
    return `<th class="${t ? 'hz-today' : ''}">${DAYS[d]}<br><span style="font-weight:600">${dt.getDate()} ${MES[dt.getMonth()]}</span></th>`;
  }).join('');

  const occRow = (label, f) => `<tr><td class="hz-name">${label}</td>${days.map(d =>
    `<td><input class="hz-in" type="number" min="0" inputmode="numeric" value="${has(o(d)[f]) ? o(d)[f] : ''}" oninput="hzOcc(${d},'${f}',this.value)"></td>`
  ).join('')}<td></td></tr>`;

  const groups = POSITIONS.map(p => ({
    p, list: hz.staff.filter(s => s.pos === p).sort((a, b) => a.name.localeCompare(b.name))
  })).filter(g => g.list.length);

  const staffRows = groups.map(g =>
    `<tr class="hz-sec"><td colspan="9">${POS_ICON[g.p]} ${g.p} (${g.list.length})</td></tr>` +
    g.list.map(s => {
      let tot = 0;
      const cells = days.map(d => {
        const c = w.shifts[s.id + '_' + d];
        tot += hrs(c);
        let cls = '', html = '+';
        if (c && c.off) { cls = 'off'; html = 'Libre'; }
        else if (c && c.s && c.e) { cls = 'on'; html = `${fmt12(c.s)}–${fmt12(c.e)}<br><span class="hz-h">${Math.round(hrs(c) * 10) / 10}h</span>`; }
        return `<td><button class="hz-cell ${cls}" onclick="hzOpenCell('${s.id}',${d})">${html}</button></td>`;
      }).join('');
      return `<tr><td class="hz-name">${esc(s.name)}</td>${cells}<td class="hz-hrs">${tot ? Math.round(tot * 10) / 10 : '—'}</td></tr>`;
    }).join('')
  ).join('');

  const counts = days.map(d => hz.staff.filter(s => { const c = w.shifts[s.id + '_' + d]; return c && c.s && c.e; }).length);

  el.innerHTML = `
    <div class="hz-bar">
      <div class="hz-title">📅 Horario</div>
      <div class="hz-wk">
        <button class="hz-nav" onclick="hzWeek(-1)" aria-label="Semana anterior">‹</button>
        <div class="hz-label">${label}</div>
        <button class="hz-nav" onclick="hzWeek(1)" aria-label="Semana siguiente">›</button>
        <button class="hz-today-btn" onclick="hzWeek(0)">Hoy</button>
      </div>
    </div>
    <div class="hz-bar">
      <button class="btn btn-o btn-sm" onclick="hzStaff()">👥 Personal</button>
      <button class="btn btn-o btn-sm" onclick="hzCopyPrev()">📋 Copiar semana anterior</button>
      <div style="margin-left:auto;font-size:.76rem;color:var(--muted);font-weight:600">Ocupación promedio: <strong id="hzAvg" style="color:var(--text)">${avgHTML(w)}</strong></div>
    </div>
    <div class="hz-wrap"><table class="hz">
      <thead><tr><th class="hz-name"></th>${head}<th>Hrs</th></tr></thead>
      <tbody>
        <tr class="hz-sec"><td colspan="9">Ocupación del día</td></tr>
        ${occRow('Cuartos en hotel', 'inh')}
        ${occRow('Quieren refresh', 'ref')}
        ${occRow('Se van', 'dep')}
        ${occRow('Llegan', 'arr')}
        <tr><td class="hz-name">Ocupación</td>${days.map(d => `<td id="hzp${d}">${pctHTML(o(d))}</td>`).join('')}<td></td></tr>
        ${staffRows || `<tr><td colspan="9" style="padding:22px;color:var(--muted)">Todavía no hay personal. Toca <strong>👥 Personal</strong> para agregarlo.</td></tr>`}
        ${hz.staff.length ? `<tr class="hz-foot"><td class="hz-name">Programadas</td>${counts.map(c => `<td>${c}</td>`).join('')}<td></td></tr>` : ''}
      </tbody>
    </table></div>
    <div class="hz-note">Ocupación = (cuartos en hotel + llegadas) ÷ ${TOTAL_ROOMS}. La semana va de domingo a sábado.</div>`;
}

// ── Navegación de semana
window.hzWeek = function (dir) {
  week = dir === 0 ? sundayOf(new Date()) : addDays(week, dir * 7);
  hzRender();
};

// ── Captura de ocupación
window.hzOcc = function (d, f, v) {
  const w = ensureWeek();
  let x = v === '' ? '' : Math.max(0, Math.floor(Number(v)));
  if (x !== '' && isNaN(x)) x = '';
  w.occ[d][f] = x;
  const c = $('hzp' + d); if (c) c.innerHTML = pctHTML(w.occ[d]);
  const a = $('hzAvg'); if (a) a.textContent = avgHTML(w);
  hzSave();
};

// ── Ventana emergente genérica
function openModal(html) {
  const ov = $('hzModal');
  ov.innerHTML = html;
  ov.classList.add('on');
}
window.hzCloseModal = function () { const ov = $('hzModal'); if (ov) ov.classList.remove('on'); cellCtx = null; };

// ── Turno de una persona en un día
function presets() {
  const m = {};
  Object.values(hz.weeks).forEach(w => Object.values(w.shifts || {}).forEach(c => {
    if (c && c.s && c.e) { const k = c.s + '|' + c.e; m[k] = (m[k] || 0) + 1; }
  }));
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k.split('|'));
}
window.hzOpenCell = function (id, d) {
  const s = hz.staff.find(x => x.id === id); if (!s) return;
  const c = viewWeek().shifts[id + '_' + d] || {};
  cellCtx = { id, d };
  const dt = parseISO(addDays(week, d));
  const pre = presets();
  openModal(`<div class="sheet" style="${SHEET}">
    <div class="sheet-hdr"><span class="sheet-title">${esc(s.name)} · ${DAYS[d]} ${dt.getDate()} ${MES[dt.getMonth()]}</span><button class="sheet-close" onclick="hzCloseModal()">✕</button></div>
    <div style="padding:14px 16px">
      ${pre.length ? `<div style="font-size:.74rem;font-weight:700;color:var(--muted);margin-bottom:6px">Turnos usados</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${pre.map(([a, b]) => `<button class="hz-chip" onclick="hzPreset('${a}','${b}')">${fmt12(a)}–${fmt12(b)}</button>`).join('')}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div><div style="font-size:.74rem;font-weight:700;color:var(--muted);margin-bottom:5px">Entrada</div><input class="hz-time" type="time" id="hzS" value="${c.s || ''}"></div>
        <div><div style="font-size:.74rem;font-weight:700;color:var(--muted);margin-bottom:5px">Salida</div><input class="hz-time" type="time" id="hzE" value="${c.e || ''}"></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:.8rem;font-weight:600;cursor:pointer">
        <input type="checkbox" id="hzAll" style="width:17px;height:17px;accent-color:var(--p)"> Poner el mismo turno en los demás días vacíos de esta semana
      </label>
    </div>
    <div class="sheet-foot" style="padding:0 16px 16px">
      <button class="btn btn-o" onclick="hzCell('clear')">Borrar</button>
      <button class="btn btn-o" onclick="hzCell('off')">Libre</button>
      <button class="btn btn-p" onclick="hzCell('save')">Guardar</button>
    </div>
  </div>`);
};
window.hzPreset = function (s, e) { $('hzS').value = s; $('hzE').value = e; };
window.hzCell = function (act) {
  if (!cellCtx) return;
  const { id, d } = cellCtx;
  const w = ensureWeek();
  const key = id + '_' + d;
  if (act === 'clear') delete w.shifts[key];
  else if (act === 'off') w.shifts[key] = { off: true };
  else {
    const s = $('hzS').value, e = $('hzE').value;
    if (!s || !e) { toast('⚠️ Pon la entrada y la salida'); return; }
    w.shifts[key] = { s, e };
    if ($('hzAll').checked) for (let i = 0; i < 7; i++) { const k = id + '_' + i; if (!w.shifts[k]) w.shifts[k] = { s, e }; }
  }
  hzSave(); hzCloseModal(); hzRender();
};

// ── Copiar la semana anterior (solo turnos, no la ocupación)
window.hzCopyPrev = function () {
  const prev = hz.weeks[addDays(week, -7)];
  if (!prev || !prev.shifts || !Object.keys(prev.shifts).length) { toast('La semana anterior no tiene turnos'); return; }
  const w = ensureWeek();
  if (Object.keys(w.shifts).length && !confirm('Esta semana ya tiene turnos. ¿Reemplazarlos con los de la semana anterior?')) return;
  w.shifts = JSON.parse(JSON.stringify(prev.shifts));
  hzSave(); hzRender(); toast('📋 Turnos copiados');
};

// ── Personal
function staffModal() {
  const groups = POSITIONS.map(p => ({ p, l: hz.staff.filter(s => s.pos === p).sort((a, b) => a.name.localeCompare(b.name)) })).filter(g => g.l.length);
  openModal(`<div class="sheet" style="${SHEET}">
    <div class="sheet-hdr"><span class="sheet-title">👥 Personal</span><button class="sheet-close" onclick="hzCloseModal()">✕</button></div>
    <div style="padding:14px 16px">
      <div style="display:grid;gap:8px;margin-bottom:14px">
        <input type="text" id="hzName" placeholder="Nombre" onkeydown="if(event.key==='Enter')hzAddStaff()">
        <select id="hzPos">${POSITIONS.map(p => `<option ${p === lastPos ? 'selected' : ''}>${p}</option>`).join('')}</select>
        <button class="btn btn-p" onclick="hzAddStaff()">Agregar</button>
      </div>
      ${groups.length ? groups.map(g => `
        <div style="font-size:.78rem;font-weight:800;color:var(--p2);margin:10px 0 2px">${POS_ICON[g.p]} ${g.p}</div>
        ${g.l.map(s => `<div class="hz-srow">
          <span style="flex:1;font-weight:600;font-size:.88rem">${esc(s.name)}</span>
          <select style="width:auto;padding:6px 8px;font-size:.76rem" onchange="hzStaffPos('${s.id}',this.value)">${POSITIONS.map(p => `<option ${p === s.pos ? 'selected' : ''}>${p}</option>`).join('')}</select>
          <button onclick="hzDelStaff('${s.id}')" style="background:none;border:none;color:#ef4444;font-size:.95rem;cursor:pointer;padding:4px 6px" aria-label="Eliminar">🗑</button>
        </div>`).join('')}`).join('') : '<div style="color:var(--muted);font-size:.84rem;text-align:center;padding:10px">Aún no hay personal.</div>'}
    </div>
  </div>`);
}
window.hzStaff = function () { staffModal(); setTimeout(() => { const n = $('hzName'); if (n) n.focus(); }, 120); };
window.hzAddStaff = function () {
  const n = $('hzName').value.trim();
  const p = $('hzPos').value;
  if (!n) { toast('⚠️ Escribe el nombre'); return; }
  lastPos = p;
  hz.staff.push({ id: rid(), name: n, pos: p });
  hzSave(); staffModal(); hzRender();
  setTimeout(() => { const i = $('hzName'); if (i) i.focus(); }, 80);
};
window.hzStaffPos = function (id, v) {
  const s = hz.staff.find(x => x.id === id); if (!s) return;
  s.pos = v; hzSave(); staffModal(); hzRender();
};
window.hzDelStaff = function (id) {
  const s = hz.staff.find(x => x.id === id); if (!s) return;
  if (!confirm(`¿Eliminar a ${s.name} y todos sus turnos?`)) return;
  hz.staff = hz.staff.filter(x => x.id !== id);
  Object.values(hz.weeks).forEach(w => { Object.keys(w.shifts || {}).forEach(k => { if (k.startsWith(id + '_')) delete w.shifts[k]; }); });
  hzSave(); staffModal(); hzRender();
};

// ── Integración con la app existente
function injectNav() {
  const nav = $('mainNav'); if (!nav) return;
  const setupBtn = nav.querySelector("[onclick*=\"'setup'\"]");   // solo existe en el menú del supervisor
  const ex = $('navHorario');
  if (setupBtn && !ex) {
    const b = document.createElement('button');
    b.className = 'nav-btn'; b.id = 'navHorario';
    b.setAttribute('onclick', "showTab('horario',this)");
    b.innerHTML = '<span class="ni">📅</span>Horario';
    nav.insertBefore(b, setupBtn);
  } else if (!setupBtn && ex) ex.remove();
}

function startSync() {
  onSnapshot(HZDOC, snap => {
    if (snap.metadata.hasPendingWrites || saveT) return;   // no pisar lo que se está escribiendo
    if (snap.exists()) {
      const d = snap.data();
      hz.staff = d.staff || [];
      hz.weeks = d.weeks || {};
    }
    const el = $('tab-horario');
    if (el && el.classList.contains('on') && !el.contains(document.activeElement)) hzRender();
  }, err => console.error('Horario:', err));
}

function boot() {
  if (!window.renderAll || !window.showTab || !$('mainNav') || !$('contentWrap')) { setTimeout(boot, 60); return; }
  injectStyles();

  const page = document.createElement('div');
  page.className = 'page'; page.id = 'tab-horario';
  $('contentWrap').appendChild(page);

  const ov = document.createElement('div');
  ov.className = 'overlay'; ov.id = 'hzModal'; ov.style.zIndex = '800';
  ov.addEventListener('click', e => { if (e.target === ov) hzCloseModal(); });
  document.body.appendChild(ov);

  // Redibujar la pestaña cuando la app llama a renderAll (sin quitar el foco si se está escribiendo)
  const origRender = window.renderAll;
  window.renderAll = function () {
    const r = origRender.apply(this, arguments);
    const el = $('tab-horario');
    if (el && el.classList.contains('on') && !el.contains(document.activeElement)) hzRender();
    return r;
  };

  new MutationObserver(injectNav).observe($('mainNav'), { childList: true });
  injectNav();
  startSync();
}
boot();
