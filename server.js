// Enzodel · Tipeos y Depósitos por plataforma
// Local: SQLite nativo (sin compilar). Vercel: Postgres (DATABASE_URL).
// Uso local: npm install; npm start -> http://localhost:3000

const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cambia-este-secreto-en-produccion';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const USE_PG = !!process.env.DATABASE_URL;

const app = express();
app.use(cors());
app.use(express.json({ limit: '6mb' }));

// ---------------- DB ----------------
let lite = null;
let pool = null;
const LIKEOP = USE_PG ? 'ILIKE' : 'LIKE';

if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
  lite = new DatabaseSync(DB_PATH);
  lite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
}

function pgParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}
async function get(sql, ...params) {
  if (USE_PG) {
    const r = await pool.query(pgParams(sql), params);
    return r.rows[0];
  }
  return lite.prepare(sql).get(...params);
}
async function all(sql, ...params) {
  if (USE_PG) {
    const r = await pool.query(pgParams(sql), params);
    return r.rows;
  }
  return lite.prepare(sql).all(...params);
}
async function run(sql, ...params) {
  if (USE_PG) {
    const returning = /^\s*insert/i.test(sql) ? ' RETURNING id' : '';
    const r = await pool.query(pgParams(sql) + returning, params);
    return { lastInsertRowid: r.rows[0] ? r.rows[0].id : undefined, changes: r.rowCount };
  }
  const r = lite.prepare(sql).run(...params);
  return { lastInsertRowid: r.lastInsertRowid !== undefined ? Number(r.lastInsertRowid) : undefined, changes: r.changes };
}

async function initDb() {
  if (USE_PG) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'moderador',
        created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      );
      CREATE TABLE IF NOT EXISTS casinos (
        id SERIAL PRIMARY KEY,
        nombre TEXT UNIQUE NOT NULL,
        moneda TEXT NOT NULL DEFAULT 'USD',
        logo TEXT,
        created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      );
      CREATE TABLE IF NOT EXISTS cuentas (
        id SERIAL PRIMARY KEY,
        casino_id INTEGER NOT NULL REFERENCES casinos(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        total_monto REAL NOT NULL DEFAULT 0,
        total_ops INTEGER NOT NULL DEFAULT 0,
        first_at TEXT,
        last_at TEXT,
        UNIQUE(casino_id, player_id)
      );
      CREATE TABLE IF NOT EXISTS depositos (
        id SERIAL PRIMARY KEY,
        casino_id INTEGER NOT NULL REFERENCES casinos(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        monto REAL NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
      );
      CREATE INDEX IF NOT EXISTS idx_dep_casino ON depositos(casino_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_cta_casino ON cuentas(casino_id, player_id);
      ALTER TABLE casinos ADD COLUMN IF NOT EXISTS logo TEXT;
    `);
  } else {
    lite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        pass_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'moderador',
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS casinos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        moneda TEXT NOT NULL DEFAULT 'USD',
        logo TEXT,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE IF NOT EXISTS cuentas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        casino_id INTEGER NOT NULL REFERENCES casinos(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        total_monto REAL NOT NULL DEFAULT 0,
        total_ops INTEGER NOT NULL DEFAULT 0,
        first_at TEXT,
        last_at TEXT,
        UNIQUE(casino_id, player_id)
      );
      CREATE TABLE IF NOT EXISTS depositos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        casino_id INTEGER NOT NULL REFERENCES casinos(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        monto REAL NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_dep_casino ON depositos(casino_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_cta_casino ON cuentas(casino_id, player_id);
    `);
    try { lite.exec('ALTER TABLE casinos ADD COLUMN logo TEXT;'); } catch { /* ya existe */ }
  }

  // Seed: admin + plataforma inicial si la base está vacía
  const u = await get('SELECT * FROM users WHERE username = ?', ADMIN_USER);
  if (!u) {
    await run('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)',
      ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10), 'admin');
    console.log(`[seed] admin: ${ADMIN_USER}`);
  }
  const existing = await all('SELECT * FROM casinos ORDER BY id LIMIT 1');
  if (!existing.length) {
    await run('INSERT INTO casinos (nombre, moneda) VALUES (?, ?)', 'Enzodel', 'USD');
    console.log('[seed] plataforma: Enzodel (USD)');
  }
}
const ready = initDb().catch(e => { console.error('Error DB:', e.message); });

// ---- Auth ----
function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Sesión inválida' });
  }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  next();
}
function nowTs() {
  const n = new Date();
  const pad = x => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())} ${pad(n.getHours())}:${pad(n.getMinutes())}:${pad(n.getSeconds())}`;
}
async function ensureReady(req, res, next) {
  try { await ready; next(); } catch { res.status(500).json({ error: 'Base no disponible' }); }
}
app.use('/api', ensureReady);

async function resumenCasino(casinoId) {
  const ftd = Number((await get('SELECT COUNT(*) AS v FROM cuentas WHERE casino_id = ?', casinoId)).v || 0);
  const agg = await get('SELECT COALESCE(SUM(total_monto),0) AS monto, COALESCE(SUM(total_ops),0) AS ops FROM cuentas WHERE casino_id = ?', casinoId);
  const red = Number((await get('SELECT COUNT(*) AS v FROM cuentas WHERE casino_id = ? AND total_ops >= 2', casinoId)).v || 0);
  return { ftd, total_monto: Number(agg.monto || 0), total_ops: Number(agg.ops || 0), redepositos: red };
}

// ---- Rutas ----
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Falta usuario o contraseña' });
  const user = await get('SELECT * FROM users WHERE username = ?', String(username).trim());
  if (!user || !bcrypt.compareSync(String(password), user.pass_hash))
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, role: user.role } });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

app.get('/api/users', auth, adminOnly, async (req, res) => {
  res.json(await all('SELECT id, username, role, created_at FROM users ORDER BY id'));
});
app.post('/api/users', auth, adminOnly, async (req, res) => {
  const { username, password, role } = req.body || {};
  const clean = String(username || '').trim();
  if (!clean || !password || String(password).length < 4)
    return res.status(400).json({ error: 'Usuario y contraseña (mín. 4) requeridos' });
  const r = role === 'admin' ? 'admin' : 'moderador';
  try {
    const info = await run('INSERT INTO users (username, pass_hash, role) VALUES (?, ?, ?)',
      clean, bcrypt.hashSync(String(password), 10), r);
    res.json({ id: info.lastInsertRowid, username: clean, role: r });
  } catch {
    res.status(400).json({ error: 'Ese usuario ya existe' });
  }
});
app.delete('/api/users/:id', auth, adminOnly, async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'No podés eliminarte a vos mismo' });
  await run('DELETE FROM users WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

app.get('/api/casinos', auth, async (req, res) => {
  const rows = await all('SELECT * FROM casinos ORDER BY nombre');
  res.json(await Promise.all(rows.map(async c => ({ ...c, resumen: await resumenCasino(c.id) }))));
});
app.post('/api/casinos', auth, adminOnly, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  const moneda = String(req.body?.moneda || 'USD').trim().toUpperCase() || 'USD';
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre' });
  try {
    const info = await run('INSERT INTO casinos (nombre, moneda) VALUES (?, ?)', nombre, moneda);
    res.json({ id: info.lastInsertRowid, nombre, moneda });
  } catch {
    res.status(400).json({ error: 'Ya existe' });
  }
});
app.delete('/api/casinos/:id', auth, adminOnly, async (req, res) => {
  await run('DELETE FROM casinos WHERE id = ?', req.params.id);
  res.json({ ok: true });
});
app.post('/api/casinos/:id/logo', auth, adminOnly, async (req, res) => {
  const logo = String(req.body?.logo || '');
  if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(logo)) return res.status(400).json({ error: 'Imagen inválida (usá PNG o JPG)' });
  if (logo.length > 700 * 1024) return res.status(400).json({ error: 'Imagen muy pesada (máx ~500KB)' });
  const c = await get('SELECT * FROM casinos WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrada' });
  await run('UPDATE casinos SET logo = ? WHERE id = ?', logo, req.params.id);
  res.json({ ok: true });
});
app.delete('/api/casinos/:id/logo', auth, adminOnly, async (req, res) => {
  await run('UPDATE casinos SET logo = NULL WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

app.get('/api/casinos/:id/resumen', auth, async (req, res) => {
  const c = await get('SELECT * FROM casinos WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrada' });
  res.json({ casino: c, ...(await resumenCasino(c.id)) });
});

app.get('/api/casinos/:id/cuentas', auth, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const rows = search
    ? await all(`SELECT * FROM cuentas WHERE casino_id = ? AND player_id ${LIKEOP} ? ORDER BY last_at DESC LIMIT 500`, req.params.id, `%${search}%`)
    : await all('SELECT * FROM cuentas WHERE casino_id = ? ORDER BY last_at DESC LIMIT 500', req.params.id);
  res.json(rows);
});

app.post('/api/depositos', auth, async (req, res) => {
  const casino_id = Number(req.body?.casino_id);
  const player_id = String(req.body?.player_id ?? '').trim();
  const monto = Number(req.body?.monto);
  if (!casino_id || !player_id) return res.status(400).json({ error: 'Casino e ID son obligatorios' });
  if (!isFinite(monto) || monto <= 0) return res.status(400).json({ error: 'El monto debe ser mayor a 0' });
  const casino = await get('SELECT * FROM casinos WHERE id = ?', casino_id);
  if (!casino) return res.status(404).json({ error: 'No encontrada' });
  const ts = nowTs();
  try {
    const dep = await run('INSERT INTO depositos (casino_id, player_id, monto, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
      casino_id, player_id, monto, req.user.id, ts);
    const ex = await get('SELECT * FROM cuentas WHERE casino_id = ? AND player_id = ?', casino_id, player_id);
    let cuenta;
    if (ex) {
      await run('UPDATE cuentas SET total_monto = total_monto + ?, total_ops = total_ops + 1, last_at = ? WHERE id = ?', monto, ts, ex.id);
      cuenta = await get('SELECT * FROM cuentas WHERE id = ?', ex.id);
    } else {
      const info = await run('INSERT INTO cuentas (casino_id, player_id, total_monto, total_ops, first_at, last_at) VALUES (?, ?, ?, 1, ?, ?)',
        casino_id, player_id, monto, ts, ts);
      cuenta = await get('SELECT * FROM cuentas WHERE id = ?', info.lastInsertRowid);
    }
    res.json({ ok: true, deposito_id: dep.lastInsertRowid, cuenta, era_nueva: cuenta.total_ops === 1 });
  } catch {
    res.status(500).json({ error: 'Error al guardar' });
  }
});

app.get('/api/depositos', auth, async (req, res) => {
  const casino_id = req.query.casino_id ? Number(req.query.casino_id) : null;
  const search = String(req.query.search || '').trim();
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  let where = '1=1';
  const params = [];
  if (casino_id) { where += ' AND d.casino_id = ?'; params.push(casino_id); }
  if (search) { where += ` AND d.player_id ${LIKEOP} ?`; params.push(`%${search}%`); }
  const rows = await all(`
    SELECT d.id, d.casino_id, c.nombre AS casino, d.player_id, d.monto, d.created_at, COALESCE(u.username,'—') AS creado_por
    FROM depositos d
    LEFT JOIN casinos c ON c.id = d.casino_id
    LEFT JOIN users u ON u.id = d.created_by
    WHERE ${where}
    ORDER BY d.id DESC LIMIT ${limit}
  `, ...params);
  res.json(rows);
});

app.delete('/api/depositos/:id', auth, adminOnly, async (req, res) => {
  const d = await get('SELECT * FROM depositos WHERE id = ?', req.params.id);
  if (!d) return res.status(404).json({ error: 'No encontrado' });
  await run('DELETE FROM depositos WHERE id = ?', d.id);
  const cta = await get('SELECT * FROM cuentas WHERE casino_id = ? AND player_id = ?', d.casino_id, d.player_id);
  if (cta) {
    const ops = cta.total_ops - 1;
    const monto = cta.total_monto - d.monto;
    if (ops <= 0) await run('DELETE FROM cuentas WHERE id = ?', cta.id);
    else await run('UPDATE cuentas SET total_ops = ?, total_monto = ? WHERE id = ?', ops, Math.max(0, monto), cta.id);
  }
  res.json({ ok: true });
});

app.get('/api/resumen', auth, async (req, res) => {
  const rows = await all('SELECT * FROM casinos ORDER BY nombre');
  const total = { ftd: 0, total_monto: 0, total_ops: 0, redepositos: 0 };
  const porCasino = [];
  for (const c of rows) {
    const r = await resumenCasino(c.id);
    total.ftd += r.ftd; total.total_monto += r.total_monto; total.total_ops += r.total_ops; total.redepositos += r.redepositos;
    porCasino.push({ casino: c, ...r });
  }
  res.json({ total, porCasino });
});

// Frontend (solo desarrollo local; en Vercel lo sirve estático)
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'No encontrado' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT} ${USE_PG ? '(Postgres)' : '(SQLite local)'}`));
}
