let token = localStorage.getItem('tip_token') || '';
let me = null;
let casinos = [];
let global = null;
let activeId = 'all';
let view = 'panel';

const $ = id => document.getElementById(id);
const api = async (path, opts = {}) => {
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Error');
  return data;
};
const fmt$ = n => '$' + Number(n || 0).toLocaleString('en-US');
const fmtN = n => Number(n || 0).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const rate = (red, ftd) => ftd ? Math.round(red / ftd * 100) : 0;
const mark = name => name
  ? `<img src="${name}" alt="">`
  : '';
const ph = nombre => `<span class="ph">${esc(nombre[0].toUpperCase())}</span>`;

const IC = {
  trash: '<svg class="ic" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>',
  warn: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>'
};

// ---- Reloj ----
function tickClock() {
  const n = new Date(), p = x => String(x).padStart(2, '0');
  const t = $('clock-time'), d = $('clock-date');
  if (t) t.textContent = `${p(n.getHours())}:${p(n.getMinutes())}`;
  if (d) d.textContent = `${p(n.getDate())}/${p(n.getMonth() + 1)}/${n.getFullYear()}`;
}
setInterval(tickClock, 15000); tickClock();

// ---- Toasts ----
function toast(title, sub = '', type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `${type === 'ok' ? IC.check : IC.warn}<div><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>`;
  $('toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 320); }, 3600);
}

// ---- Confirm ----
let cfResolve = null;
function confirmDlg(title, msg, yesLabel = 'Eliminar') {
  $('cf-title').textContent = title;
  $('cf-msg').textContent = msg;
  $('cf-yes').textContent = yesLabel;
  $('confirm-modal').classList.remove('hidden');
  return new Promise(res => { cfResolve = res; });
}
function closeConfirm(v) { $('confirm-modal').classList.add('hidden'); if (cfResolve) { cfResolve(v); cfResolve = null; } }

// ---- Sesión ----
async function doLogin() {
  $('login-error').textContent = '';
  const btn = $('btn-login');
  btn.disabled = true; btn.textContent = 'Verificando…';
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('login-user').value.trim(), password: $('login-pass').value }) });
    token = d.token; me = d.user;
    localStorage.setItem('tip_token', token);
    showApp();
  } catch (e) { $('login-error').textContent = e.message; }
  btn.disabled = false; btn.textContent = 'Iniciar sesión';
}
function syncSideUser() {
  if (!me) return;
  $('user-menu-label').textContent = me.username + (me.role === 'admin' ? ' · adm' : '');
  $('side-avatar').textContent = me.username[0].toUpperCase();
  $('side-user').textContent = me.username;
  $('side-role').textContent = me.role === 'admin' ? 'Administrador' : 'Moderador';
}
function showApp() {
  $('login-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  syncSideUser();
  loadAll();
}
function logout() { token = ''; me = null; localStorage.removeItem('tip_token'); location.reload(); }
function showView(v) {
  view = v;
  $('nav-panel').classList.toggle('active', v === 'panel');
  $('nav-config').classList.toggle('active', v === 'config');
  $('view-panel').classList.toggle('hidden', v !== 'panel');
  $('view-config').classList.toggle('hidden', v !== 'config');
  closeAllMenus();
  enterAnim();
  if (v === 'config') { $('page-eyebrow').textContent = 'Administración'; $('page-title').textContent = 'Ajustes'; $('page-sub').textContent = 'Plataformas, logos y equipo'; }
  else syncTopbar();
}
function selectActive(id) {
  activeId = id;
  if (view !== 'panel') showView('panel'); else { renderRail(); renderPanel(); syncTopbar(); enterAnim(); }
}
function syncTopbar() {
  if (activeId === 'all') { $('page-eyebrow').textContent = 'Panel general'; $('page-title').textContent = 'Enzodel'; $('page-sub').textContent = 'Todas las plataformas'; }
  else { const c = casinos.find(x => x.id === activeId); $('page-eyebrow').textContent = 'Plataforma · USD'; $('page-title').textContent = c ? c.nombre : 'Panel'; $('page-sub').textContent = 'Detalle de la plataforma'; }
}
function enterAnim() {
  const vis = view === 'panel' ? $('view-panel') : $('view-config');
  vis.classList.remove('view-enter'); void vis.offsetWidth; vis.classList.add('view-enter');
}
function closeAllMenus() { document.querySelectorAll('.dd-menu').forEach(m => m.classList.add('hidden')); }
document.addEventListener('click', e => { if (!e.target.closest('.dd')) closeAllMenus(); });

// ---- Carga ----
async function loadAll() {
  try {
    if (!me) { me = (await api('/api/me')).user; syncSideUser(); }
    casinos = await api('/api/casinos');
    global = await api('/api/resumen');
    if (casinos.length && activeId !== 'all' && !casinos.find(c => c.id === activeId)) activeId = 'all';
    renderRail(); renderPanel(); renderConfig(); syncTopbar();
    const sel = $('f-casino'); sel.innerHTML = '';
    casinos.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.nombre; if (c.id === activeId) o.selected = true; sel.appendChild(o); });
  } catch (e) { if (/autentic|válida/i.test(e.message)) logout(); else toast('Error de conexión', e.message, 'err'); }
}

// ---- Riel de plataformas ----
function renderRail() {
  if (global) $('g-tab-total').textContent = fmt$(global.total.total_monto);
  $('tab-general').classList.toggle('active', activeId === 'all');
  $('casino-count').textContent = casinos.length;
  const el = $('casino-list'); el.innerHTML = '';
  casinos.forEach(c => {
    const b = document.createElement('button');
    b.className = 'plat-pill' + (c.id === activeId ? ' active' : '');
    b.innerHTML = `${c.logo ? mark(c.logo) : ph(c.nombre)}<span class="grow"><b>${esc(c.nombre)}</b><br><small>${fmt$(c.resumen.total_monto)}</small></span>`;
    b.onclick = () => selectActive(c.id);
    el.appendChild(b);
  });
}

// ---- Panel ----
function renderPanel() {
  const isAll = activeId === 'all';
  $('general-view').classList.toggle('hidden', !isAll);
  $('casino-view').classList.toggle('hidden', isAll);
  if (isAll) renderGeneral(); else renderCasinoDetail();
}
const emptyRow = (cols, title, sub) =>
  `<tr class="empty-row"><td colspan="${cols}"><div class="empty-art">${IC.inbox}</div><b>${title}</b><br><span class="small">${sub}</span></td></tr>`;

function renderGeneral() {
  if (!global) return;
  const t = global.total;
  $('vault-amount').textContent = fmt$(t.total_monto);
  $('vault-sub').textContent = `${fmtN(t.ftd)} cuentas con depósitos · ${fmtN(t.total_ops)} movimientos · ${fmtN(t.redepositos)} con redepósito`;
  $('g2-ftd').textContent = fmtN(t.ftd);
  $('g2-monto').textContent = fmt$(t.total_monto);
  $('g2-ops').textContent = fmtN(t.total_ops);
  $('g2-red').textContent = fmtN(t.redepositos);
  $('g2-rate').textContent = 'tasa ' + rate(t.redepositos, t.ftd) + '%';
  $('casino-cards').innerHTML = global.porCasino.map(r =>
    `<button class="ledger-row" data-go="${r.casino.id}">
      ${r.casino.logo ? mark(r.casino.logo) : ph(r.casino.nombre)}
      <span class="who"><b>${esc(r.casino.nombre)}</b><span>${fmtN(r.ftd)} cuentas · ${fmtN(r.total_ops)} movimientos</span></span>
      <span class="m"><span>FTD</span><b>${fmtN(r.ftd)}</b></span>
      <span class="m"><span>N° dep.</span><b>${fmtN(r.total_ops)}</b></span>
      <span class="m opt"><span>Redepósitos</span><b>${fmtN(r.redepositos)}</b></span>
      <span class="m hl"><span>Total USD</span><b>${fmt$(r.total_monto)}</b></span>
      <span class="go">Abrir →</span>
    </button>`
  ).join('') || `<div class="card"><p class="muted" style="margin:0">Sin plataformas todavía. Creá la primera en <b>Ajustes</b>.</p></div>`;
  $('casino-cards').querySelectorAll('[data-go]').forEach(b => b.onclick = () => selectActive(Number(b.dataset.go)));
  renderHistAll();
}
async function renderHistAll() {
  const q = $('search-hist-all').value || '';
  const rows = await api(`/api/depositos?limit=100&search=${encodeURIComponent(q)}`);
  $('tbody-hist-all').innerHTML = rows.map(d =>
    `<tr><td class="muted">${esc(d.created_at)}</td><td>${esc(d.casino || '—')}</td><td><span class="id">${esc(d.player_id)}</span></td><td class="num"><b>${fmt$(d.monto)}</b></td><td class="muted">${esc(d.creado_por)}</td></tr>`
  ).join('') || emptyRow(5, 'Sin movimientos', 'Usá “Añadir depósito” para registrar el primero');
}
function renderCasinoDetail() {
  const c = casinos.find(x => x.id === activeId);
  if (!c) { selectActive('all'); return; }
  $('hero-casino-badge').textContent = 'Plataforma · USD';
  $('hero-title').textContent = c.nombre;
  const hl = $('hero-logo'), fb = $('hero-fallback');
  if (c.logo) { hl.src = c.logo; hl.classList.remove('hidden'); fb.classList.add('hidden'); }
  else { hl.classList.add('hidden'); fb.classList.remove('hidden'); fb.textContent = c.nombre[0].toUpperCase(); }
  $('ctx-cuentas').textContent = fmtN(c.resumen.ftd) + (c.resumen.ftd === 1 ? ' cuenta' : ' cuentas');
  $('ctx-monto').textContent = fmt$(c.resumen.total_monto);
  $('s-ftd').textContent = fmtN(c.resumen.ftd);
  $('s-monto').textContent = fmt$(c.resumen.total_monto);
  $('s-ops').textContent = fmtN(c.resumen.total_ops);
  $('s-red').textContent = fmtN(c.resumen.redepositos);
  $('s-rate').textContent = 'tasa ' + rate(c.resumen.redepositos, c.resumen.ftd) + '%';
  renderCuentas(); renderHist();
}
async function renderCuentas() {
  const q = $('search-cuentas').value || '';
  const rows = await api(`/api/casinos/${activeId}/cuentas?search=${encodeURIComponent(q)}`);
  $('tbody-cuentas').innerHTML = rows.map(c =>
    `<tr><td><span class="id">${esc(c.player_id)}</span>${c.total_ops >= 2 ? '<span class="tag re">redepósito</span>' : '<span class="tag new">nueva</span>'}</td>
    <td class="num">${c.total_ops}</td><td class="num"><b>${fmt$(c.total_monto)}</b></td><td class="muted">${esc(c.last_at || '—')}</td></tr>`
  ).join('') || emptyRow(4, 'Sin cuentas en esta plataforma', 'Usá “Añadir depósito” para registrar la primera');
}
async function renderHist() {
  const q = $('search-hist').value || '';
  const rows = await api(`/api/depositos?casino_id=${activeId}&limit=100&search=${encodeURIComponent(q)}`);
  const isAdmin = me && me.role === 'admin';
  $('tbody-hist').innerHTML = rows.map(d =>
    `<tr><td class="muted">${esc(d.created_at)}</td><td><span class="id">${esc(d.player_id)}</span></td><td class="num"><b>${fmt$(d.monto)}</b></td><td class="muted">${esc(d.creado_por)}</td>
    <td style="text-align:right">${isAdmin ? `<button class="del" onclick="delDep(${d.id})" title="Eliminar depósito">${IC.trash}</button>` : ''}</td></tr>`
  ).join('') || emptyRow(5, 'Sin movimientos', 'Todavía no hay depósitos en esta plataforma');
}

// ---- Ajustes ----
async function renderConfig() {
  const isAdmin = me && me.role === 'admin';
  $('config-lock').classList.toggle('hidden', isAdmin);
  $('config-body').classList.toggle('hidden', !isAdmin);
  if (!isAdmin) return;
  const users = await api('/api/users');
  $('users-list').innerHTML = users.map(u =>
    `<li data-uid="${u.id}"><span>${u.role === 'admin' ? '<span class="pill gold">administrador</span>' : '<span class="pill">moderador</span>'} <b>${esc(u.username)}</b>${u.username === me.username ? ' <span class="pill">tu cuenta</span>' : ''}</span>
    <span class="u-actions" style="display:flex;gap:6px;align-items:center">
      <button class="row-btn" data-pw="${u.id}">Clave</button>
      ${u.username !== me.username ? `<button class="del" data-deluser="${u.id}">Quitar acceso</button>` : ''}
    </span></li>`
  ).join('');
  $('users-list').querySelectorAll('[data-deluser]').forEach(b => b.onclick = () => delUser(Number(b.dataset.deluser)));
  $('users-list').querySelectorAll('[data-pw]').forEach(b => b.onclick = () => pwEditor(Number(b.dataset.pw)));
  $('config-casino-list').innerHTML = casinos.map(c =>
    `<li><span style="display:flex;gap:10px;align-items:center">${c.logo ? `<img src="${c.logo}" class="logo-thumb" alt="">` : ph(c.nombre)}<span><b>${esc(c.nombre)}</b><br><span class="pill">${fmtN(c.resumen.ftd)} FTD · ${fmt$(c.resumen.total_monto)}</span></span></span>
    <span style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end">
      <label class="pill" style="cursor:pointer" for="logo-upload-${c.id}">Cambiar logo</label>
      <input type="file" accept="image/*" id="logo-upload-${c.id}" data-casino="${c.id}" class="hidden">
      ${c.logo ? `<button class="row-btn" data-unlogo="${c.id}">Quitar logo</button>` : ''}
      <button class="del" data-delcasino="${c.id}" data-nombre="${esc(c.nombre)}">Eliminar plataforma</button>
    </span></li>`
  ).join('') || '<li class="muted">Todavía no hay plataformas.</li>';
  $('config-casino-list').querySelectorAll('input[type=file]').forEach(i => i.onchange = () => uploadLogo(Number(i.dataset.casino), i.files[0]));
  $('config-casino-list').querySelectorAll('[data-unlogo]').forEach(b => b.onclick = () => delLogo(Number(b.dataset.unlogo)));
  $('config-casino-list').querySelectorAll('[data-delcasino]').forEach(b => b.onclick = () => delCasino(Number(b.dataset.delcasino), b.dataset.nombre));
}

function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('Elegí un archivo de imagen válido'));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 256, sc = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('No se pudo leer la imagen'));
    img.src = url;
  });
}
async function uploadLogo(casinoId, file) {
  try {
    const logo = await fileToLogo(file);
    await api(`/api/casinos/${casinoId}/logo`, { method: 'POST', body: JSON.stringify({ logo }) });
    await loadAll();
    toast('Logo actualizado', 'Ya se ve en el panel');
  } catch (e) { toast('No se pudo subir', e.message, 'err'); }
}
async function delLogo(id) {
  if (!await confirmDlg('Quitar logo', 'La plataforma quedará con su inicial. Podés subir otro después.', 'Quitar')) return;
  await api(`/api/casinos/${id}/logo`, { method: 'DELETE' }); loadAll();
  toast('Logo eliminado');
}

// ---- Acciones ----
async function saveDeposito() {
  $('form-error').textContent = '';
  const btn = $('btn-save'); btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    const body = { casino_id: Number($('f-casino').value), player_id: $('f-id').value.trim(), monto: Number($('f-monto').value) };
    if (!body.player_id) throw new Error('Escribí el ID de la cuenta');
    if (!(body.monto > 0)) throw new Error('El monto debe ser mayor a 0');
    const r = await api('/api/depositos', { method: 'POST', body: JSON.stringify(body) });
    activeId = body.casino_id;
    closeModal(); $('f-id').value = ''; $('f-monto').value = '';
    if (view !== 'panel') showView('panel');
    await loadAll();
    toast(
      r.era_nueva ? `Cuenta ${body.player_id} creada` : `Depósito guardado en ${body.player_id}`,
      `$${body.monto} · ${r.cuenta.total_ops} dep. / $${r.cuenta.total_monto} total`
    );
  } catch (e) { $('form-error').textContent = e.message; }
  btn.disabled = false; btn.textContent = 'Guardar depósito';
}
async function delDep(id) {
  if (!await confirmDlg('Eliminar depósito', 'Se borrará el movimiento y se restará de la cuenta.', 'Eliminar')) return;
  await api('/api/depositos/' + id, { method: 'DELETE' }); loadAll();
  toast('Depósito eliminado', 'Movimiento borrado del historial');
}
async function delUser(id) {
  if (!await confirmDlg('Quitar acceso', 'Esa persona perderá el acceso al panel.', 'Quitar')) return;
  await api('/api/users/' + id, { method: 'DELETE' }); renderConfig();
  toast('Acceso retirado');
}
function pwEditor(id) {
  const box = document.querySelector(`#users-list li[data-uid="${id}"] .u-actions`);
  if (!box || box.dataset.editing) return;
  box.dataset.editing = '1';
  box.innerHTML = `<input type="password" id="pw-${id}" placeholder="Nueva clave" style="width:150px"><button class="primary row-btn" id="pwok-${id}">Guardar</button><button class="row-btn" id="pwno-${id}">Cancelar</button>`;
  $('pwok-' + id).onclick = async () => {
    try {
      await api(`/api/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password: $('pw-' + id).value }) });
      toast('Clave actualizada');
      renderConfig();
    } catch (e) { toast('No se pudo', e.message, 'err'); }
  };
  $('pwno-' + id).onclick = () => renderConfig();
  $('pw-' + id).focus();
}
async function delCasino(id, nombre) {
  if (!await confirmDlg('Eliminar plataforma', `"${nombre}": sus cuentas y su historial se borrarán.`, 'Eliminar')) return;
  await api('/api/casinos/' + id, { method: 'DELETE' });
  if (activeId === id) activeId = 'all';
  loadAll();
  toast('Plataforma eliminada', nombre);
}
async function createCasino() {
  try {
    const nombre = $('new-casino').value.trim();
    if (!nombre) { toast('Falta el nombre', 'Escribí el nombre de la plataforma', 'err'); return; }
    const d = await api('/api/casinos', { method: 'POST', body: JSON.stringify({ nombre, moneda: 'USD' }) });
    const f = $('new-casino-logo').files[0];
    if (f) { try { const logo = await fileToLogo(f); await api(`/api/casinos/${d.id}/logo`, { method: 'POST', body: JSON.stringify({ logo }) }); } catch (e) { toast('Plataforma creada, falló el logo', e.message, 'err'); } }
    $('new-casino').value = ''; $('new-casino-logo').value = ''; $('new-casino-preview').classList.add('hidden');
    activeId = d.id; showView('panel'); loadAll();
    toast('Plataforma creada', nombre);
  } catch (e) { toast('No se pudo crear', e.message, 'err'); }
}
function openModal() { $('modal').classList.remove('hidden'); setTimeout(() => $('f-id').focus(), 50); }
function closeModal() { $('modal').classList.add('hidden'); }

// Eventos
$('btn-login').onclick = doLogin;
$('login-user').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('btn-add').onclick = openModal;
$('btn-logout').onclick = logout;
$('btn-cancel').onclick = closeModal;
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeConfirm(false); closeAllMenus(); } });
$('btn-save').onclick = saveDeposito;
$('cf-no').onclick = () => closeConfirm(false);
$('cf-yes').onclick = () => closeConfirm(true);
$('nav-panel').onclick = () => showView('panel');
$('nav-config').onclick = () => showView('config');
$('tab-general').onclick = () => selectActive('all');
$('search-cuentas').oninput = renderCuentas;
$('search-hist').oninput = renderHist;
$('search-hist-all').oninput = renderHistAll;
$('btn-casino').onclick = createCasino;
$('new-casino-logo').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try { $('new-casino-preview').src = await fileToLogo(f); $('new-casino-preview').classList.remove('hidden'); }
  catch (err) { toast('Imagen inválida', err.message, 'err'); }
};
$('btn-user').onclick = async () => {
  try {
    const u = $('new-user').value.trim();
    if (!u) { toast('Falta el usuario', 'Escribí un nombre de usuario', 'err'); return; }
    await api('/api/users', { method: 'POST', body: JSON.stringify({ username: u, password: $('new-pass').value, role: $('new-role').value }) });
    $('new-user').value = ''; $('new-pass').value = ''; renderConfig();
    toast('Acceso concedido', `${u} ya puede iniciar sesión`);
  } catch (e) { toast('No se pudo crear', e.message, 'err'); }
};
$('user-menu-btn').onclick = e => { e.stopPropagation(); $('user-menu').classList.toggle('hidden'); };
$('menu-go-panel').onclick = () => showView('panel');
$('menu-go-config').onclick = () => showView('config');
$('menu-logout').onclick = logout;
window.delDep = delDep; window.delUser = delUser; window.delCasino = delCasino; window.delLogo = delLogo;

(async () => { if (token) { try { me = (await api('/api/me')).user; showApp(); } catch { logout(); } } })();
