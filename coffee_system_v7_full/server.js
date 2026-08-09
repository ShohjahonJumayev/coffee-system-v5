const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const { Pool, types } = require('pg');

types.setTypeParser(20, v => Number(v));
types.setTypeParser(1700, v => Number(v));

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const DATABASE_URL = process.env.DATABASE_URL || '';
const NODE_ENV = process.env.NODE_ENV || 'development';
const SESSION_SECRET = process.env.SESSION_SECRET || (NODE_ENV === 'production' ? '' : 'dev-secret-change-me');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (NODE_ENV === 'production' ? '' : 'admin123');
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').replace(/\/$/, '');

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.error('SESSION_SECRET is required in production');
  process.exit(1);
}
if (!ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD is required for first production launch');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setAuthCookie(res, token) {
  const attrs = [
    `coffee_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`,
  ];
  if (NODE_ENV === 'production') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearAuthCookie(res) {
  const attrs = ['coffee_token=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (NODE_ENV === 'production') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function signUser(user) {
  return jwt.sign({ id: user.id, role: user.role, branchId: user.branch_id, name: user.name }, SESSION_SECRET, { expiresIn: '7d' });
}

async function auth(req, res, next) {
  try {
    const token = cookieValue(req, 'coffee_token');
    if (!token) return res.status(401).json({ error: 'Требуется вход' });
    const data = jwt.verify(token, SESSION_SECRET);
    const { rows } = await pool.query('SELECT id, username, name, role, branch_id, active FROM users WHERE id=$1', [data.id]);
    const user = rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Пользователь недоступен' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Сессия истекла' });
  }
}

function allow(...roles) {
  return (req, res, next) => roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Недостаточно прав' });
}

async function resolveBranch(req, { allowAny = false } = {}) {
  if (req.user.role !== 'owner' && req.user.branch_id) return Number(req.user.branch_id);
  const header = Number(req.headers['x-branch-id'] || 0);
  if (header > 0) {
    const { rows } = await pool.query('SELECT id FROM branches WHERE id=$1 AND active=true', [header]);
    if (rows[0]) return header;
  }
  if (allowAny) return null;
  const { rows } = await pool.query('SELECT id FROM branches WHERE active=true ORDER BY id LIMIT 1');
  if (!rows[0]) throw new Error('Нет активного филиала');
  return Number(rows[0].id);
}

function safeRole(role) {
  return ['owner', 'admin', 'cashier'].includes(role) ? role : null;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [kind,salt,hashHex] = String(stored||'').split('$');
    if (kind !== 'scrypt' || !salt || !hashHex) return false;
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(hashHex, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function saleMethodLabel(method) {
  return method === 'cash' ? 'Наличные' : method === 'card' ? 'Карта' : 'Онлайн';
}

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS branches (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner','admin','cashier')),
        branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Кофе',
        price BIGINT NOT NULL CHECK (price >= 0),
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS inventory_items (
        id SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'шт',
        quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
        threshold NUMERIC(14,3) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS recipes (
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        inventory_item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
        quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
        PRIMARY KEY (branch_id, product_id, inventory_item_id)
      );
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id BIGSERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        inventory_item_id INTEGER REFERENCES inventory_items(id) ON DELETE SET NULL,
        item_name_snapshot TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('receive','sale','adjustment_in','adjustment_out')),
        quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
        reason TEXT NOT NULL DEFAULT '',
        sale_id BIGINT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sales (
        id BIGSERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        user_id INTEGER REFERENCES users(id),
        method TEXT NOT NULL CHECK (method IN ('cash','card','online')),
        total BIGINT NOT NULL CHECK (total >= 0),
        source TEXT NOT NULL DEFAULT 'pos',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS sale_items (
        id BIGSERIAL PRIMARY KEY,
        sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        name_snapshot TEXT NOT NULL,
        price BIGINT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0)
      );
      CREATE TABLE IF NOT EXISTS cash_operations (
        id BIGSERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        user_id INTEGER REFERENCES users(id),
        type TEXT NOT NULL CHECK (type IN ('cash_in','cash_out')),
        amount BIGINT NOT NULL CHECK (amount > 0),
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS online_orders (
        id BIGSERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','ready','completed','cancelled')),
        total BIGINT NOT NULL CHECK (total >= 0),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS online_order_items (
        id BIGSERIAL PRIMARY KEY,
        order_id BIGINT NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        name_snapshot TEXT NOT NULL,
        price BIGINT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0)
      );
      CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON sales(branch_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cash_branch_created ON cash_operations(branch_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON online_orders(branch_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_branch ON inventory_items(branch_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_created ON inventory_movements(branch_id,created_at DESC);
    `);

    const branchCount = Number((await client.query('SELECT COUNT(*)::int AS c FROM branches')).rows[0].c);
    if (branchCount === 0) {
      await client.query("INSERT INTO branches(name,address) VALUES('Основной филиал','')");
    }
    const firstBranch = (await client.query('SELECT id FROM branches ORDER BY id LIMIT 1')).rows[0].id;

    const userCount = Number((await client.query('SELECT COUNT(*)::int AS c FROM users')).rows[0].c);
    if (userCount === 0) {
      const hash = hashPassword(ADMIN_PASSWORD);
      await client.query('INSERT INTO users(username,password_hash,name,role,branch_id) VALUES($1,$2,$3,$4,$5)', [ADMIN_USERNAME, hash, 'Владелец', 'owner', firstBranch]);
    }

    const productCount = Number((await client.query('SELECT COUNT(*)::int AS c FROM products')).rows[0].c);
    if (productCount === 0) {
      const defaults = [
        ['Капучино','Кофе',25000],['Латте','Кофе',27000],['Американо','Кофе',18000],
        ['Эспрессо','Кофе',15000],['Мохито','Напитки',22000],['Чизкейк','Десерты',30000]
      ];
      for (const p of defaults) await client.query('INSERT INTO products(name,category,price) VALUES($1,$2,$3)', p);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'coffee-system-v7', database: 'ok' });
  } catch (e) {
    res.status(503).json({ ok: false, database: 'error' });
  }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const { rows } = await pool.query('SELECT id,username,password_hash,name,role,branch_id,active FROM users WHERE username=$1', [username]);
  const user = rows[0];
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  setAuthCookie(res, signUser(user));
  res.json({ ok: true, user: { id: user.id, username: user.username, name: user.name, role: user.role, branchId: user.branch_id } });
});

app.post('/api/logout', (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

app.get('/api/me', auth, async (req, res) => {
  const branches = (await pool.query('SELECT id,name,address FROM branches WHERE active=true ORDER BY id')).rows;
  res.json({ user: { id:req.user.id, username:req.user.username, name:req.user.name, role:req.user.role, branchId:req.user.branch_id }, branches });
});

app.post('/api/me/password', auth, async (req, res) => {
  const current = String(req.body.currentPassword || '');
  const next = String(req.body.newPassword || '');
  if (next.length < 8) return res.status(400).json({ error: 'Новый пароль должен быть не короче 8 символов' });
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id=$1', [req.user.id]);
  if (!verifyPassword(current, rows[0].password_hash)) return res.status(400).json({ error: 'Текущий пароль неверный' });
  await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(next), req.user.id]);
  res.json({ ok: true });
});

app.get('/api/branches', auth, async (req, res) => {
  res.json((await pool.query('SELECT id,name,address,active,created_at FROM branches ORDER BY id')).rows);
});

app.post('/api/branches', auth, allow('owner'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const address = String(req.body.address || '').trim();
  if (!name) return res.status(400).json({ error: 'Введите название филиала' });
  const { rows } = await pool.query('INSERT INTO branches(name,address) VALUES($1,$2) RETURNING *', [name,address]);
  res.json({ ok: true, branch: rows[0] });
});

app.put('/api/branches/:id', auth, allow('owner'), async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const address = String(req.body.address || '').trim();
  const active = req.body.active !== false;
  if (!id || !name) return res.status(400).json({ error: 'Некорректные данные' });
  const { rows } = await pool.query('UPDATE branches SET name=$1,address=$2,active=$3 WHERE id=$4 RETURNING *', [name,address,active,id]);
  if (!rows[0]) return res.status(404).json({ error: 'Филиал не найден' });
  res.json({ ok:true, branch: rows[0] });
});

app.get('/api/users', auth, allow('owner'), async (req, res) => {
  const { rows } = await pool.query(`SELECT u.id,u.username,u.name,u.role,u.branch_id,u.active,b.name AS branch_name,u.created_at
    FROM users u LEFT JOIN branches b ON b.id=u.branch_id ORDER BY u.id`);
  res.json(rows);
});

app.post('/api/users', auth, allow('owner'), async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const name = String(req.body.name || '').trim();
  const role = safeRole(req.body.role);
  const branchId = req.body.branchId ? Number(req.body.branchId) : null;
  if (!username || !name || !role || password.length < 8) return res.status(400).json({ error: 'Заполните поля; пароль минимум 8 символов' });
  try {
    const hash = hashPassword(password);
    const { rows } = await pool.query('INSERT INTO users(username,password_hash,name,role,branch_id) VALUES($1,$2,$3,$4,$5) RETURNING id,username,name,role,branch_id,active', [username,hash,name,role,branchId]);
    res.json({ ok:true, user:rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(400).json({ error:'Такой логин уже существует' });
    throw e;
  }
});

app.put('/api/users/:id', auth, allow('owner'), async (req, res) => {
  const id = Number(req.params.id);
  const name = String(req.body.name || '').trim();
  const role = safeRole(req.body.role);
  const branchId = req.body.branchId ? Number(req.body.branchId) : null;
  const active = req.body.active !== false;
  if (!id || !name || !role) return res.status(400).json({ error:'Некорректные данные' });
  if (id === req.user.id && (!active || role !== 'owner')) return res.status(400).json({ error:'Нельзя отключить себе доступ владельца' });
  const { rows } = await pool.query('UPDATE users SET name=$1,role=$2,branch_id=$3,active=$4 WHERE id=$5 RETURNING id,username,name,role,branch_id,active', [name,role,branchId,active,id]);
  if (!rows[0]) return res.status(404).json({ error:'Пользователь не найден' });
  res.json({ ok:true, user:rows[0] });
});

app.post('/api/users/:id/reset-password', auth, allow('owner'), async (req, res) => {
  const id = Number(req.params.id);
  const password = String(req.body.password || '');
  if (password.length < 8) return res.status(400).json({ error:'Пароль минимум 8 символов' });
  const result = await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hashPassword(password), id]);
  if (!result.rowCount) return res.status(404).json({ error:'Пользователь не найден' });
  res.json({ ok:true });
});

app.get('/api/products', auth, async (req, res) => {
  res.json((await pool.query('SELECT id,name,category,price,active FROM products WHERE active=true ORDER BY category,name')).rows);
});

app.get('/api/products/all', auth, allow('owner','admin'), async (req, res) => {
  res.json((await pool.query('SELECT id,name,category,price,active FROM products ORDER BY active DESC,category,name')).rows);
});

app.post('/api/products', auth, allow('owner','admin'), async (req, res) => {
  const name=String(req.body.name||'').trim(), category=String(req.body.category||'Кофе').trim(), price=Number(req.body.price);
  if(!name || !Number.isFinite(price) || price<0) return res.status(400).json({error:'Введите название и цену'});
  const {rows}=await pool.query('INSERT INTO products(name,category,price) VALUES($1,$2,$3) RETURNING *',[name,category||'Кофе',Math.round(price)]);
  res.json({ok:true,product:rows[0]});
});

app.put('/api/products/:id', auth, allow('owner','admin'), async (req,res)=>{
  const id=Number(req.params.id), name=String(req.body.name||'').trim(), category=String(req.body.category||'Кофе').trim(), price=Number(req.body.price), active=req.body.active!==false;
  if(!id || !name || !Number.isFinite(price) || price<0) return res.status(400).json({error:'Некорректные данные'});
  const {rows}=await pool.query('UPDATE products SET name=$1,category=$2,price=$3,active=$4 WHERE id=$5 RETURNING *',[name,category,Math.round(price),active,id]);
  if(!rows[0]) return res.status(404).json({error:'Товар не найден'});
  res.json({ok:true,product:rows[0]});
});

app.get('/api/warehouse', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const {rows}=await pool.query('SELECT id,name,unit,quantity,threshold,(quantity<=threshold) AS low FROM inventory_items WHERE branch_id=$1 ORDER BY name',[branchId]);
  res.json(rows);
});

app.post('/api/warehouse', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req), name=String(req.body.name||'').trim(), unit=String(req.body.unit||'шт').trim(), quantity=Number(req.body.quantity), threshold=Number(req.body.threshold||0);
  if(!name || !Number.isFinite(quantity) || quantity<0 || !Number.isFinite(threshold) || threshold<0) return res.status(400).json({error:'Некорректные данные'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const {rows}=await client.query('INSERT INTO inventory_items(branch_id,name,unit,quantity,threshold) VALUES($1,$2,$3,$4,$5) RETURNING *',[branchId,name,unit||'шт',quantity,threshold]);
    if(quantity>0) await client.query(`INSERT INTO inventory_movements(branch_id,inventory_item_id,item_name_snapshot,type,quantity,reason,user_id) VALUES($1,$2,$3,'receive',$4,$5,$6)`,[branchId,rows[0].id,name,quantity,'Начальный остаток',req.user.id]);
    await client.query('COMMIT');
    res.json({ok:true,item:rows[0]});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});

app.put('/api/warehouse/:id', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id), name=String(req.body.name||'').trim(), unit=String(req.body.unit||'шт').trim(), quantity=Number(req.body.quantity), threshold=Number(req.body.threshold||0);
  if(!id || !name || !Number.isFinite(quantity) || quantity<0 || !Number.isFinite(threshold) || threshold<0) return res.status(400).json({error:'Некорректные данные'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const current=(await client.query('SELECT * FROM inventory_items WHERE id=$1 AND branch_id=$2 FOR UPDATE',[id,branchId])).rows[0];
    if(!current){await client.query('ROLLBACK');return res.status(404).json({error:'Позиция не найдена'});}
    const diff=quantity-Number(current.quantity);
    const {rows}=await client.query('UPDATE inventory_items SET name=$1,unit=$2,quantity=$3,threshold=$4 WHERE id=$5 AND branch_id=$6 RETURNING *',[name,unit,quantity,threshold,id,branchId]);
    if(diff!==0) await client.query(`INSERT INTO inventory_movements(branch_id,inventory_item_id,item_name_snapshot,type,quantity,reason,user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[branchId,id,name,diff>0?'adjustment_in':'adjustment_out',Math.abs(diff),'Ручная корректировка',req.user.id]);
    await client.query('COMMIT');
    res.json({ok:true,item:rows[0]});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});

app.post('/api/warehouse/:id/receive', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id), quantity=Number(req.body.quantity), reason=String(req.body.reason||'Поступление').trim()||'Поступление';
  if(!id || !Number.isFinite(quantity) || quantity<=0) return res.status(400).json({error:'Введите количество больше 0'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const item=(await client.query('SELECT * FROM inventory_items WHERE id=$1 AND branch_id=$2 FOR UPDATE',[id,branchId])).rows[0];
    if(!item){await client.query('ROLLBACK');return res.status(404).json({error:'Позиция не найдена'});}
    await client.query('UPDATE inventory_items SET quantity=quantity+$1 WHERE id=$2',[quantity,id]);
    await client.query(`INSERT INTO inventory_movements(branch_id,inventory_item_id,item_name_snapshot,type,quantity,reason,user_id) VALUES($1,$2,$3,'receive',$4,$5,$6)`,[branchId,id,item.name,quantity,reason,req.user.id]);
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});

app.get('/api/warehouse-movements', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const {rows}=await pool.query(`SELECT m.id,m.item_name_snapshot AS item_name,m.type,m.quantity,m.reason,m.sale_id,m.created_at,u.name AS user_name
    FROM inventory_movements m LEFT JOIN users u ON u.id=m.user_id WHERE m.branch_id=$1 ORDER BY m.created_at DESC LIMIT 150`,[branchId]);
  res.json(rows);
});

app.delete('/api/warehouse/:id', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id);
  const result=await pool.query('DELETE FROM inventory_items WHERE id=$1 AND branch_id=$2',[id,branchId]);
  if(!result.rowCount) return res.status(404).json({error:'Позиция не найдена'});
  res.json({ok:true});
});

app.get('/api/recipes', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const {rows}=await pool.query('SELECT branch_id,product_id,inventory_item_id,quantity FROM recipes WHERE branch_id=$1 ORDER BY product_id,inventory_item_id',[branchId]);
  res.json(rows);
});

app.put('/api/recipes/:productId', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req), productId=Number(req.params.productId), items=Array.isArray(req.body.items)?req.body.items:[];
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query('DELETE FROM recipes WHERE branch_id=$1 AND product_id=$2',[branchId,productId]);
    for(const item of items){
      const inventoryId=Number(item.inventoryItemId), quantity=Number(item.quantity);
      if(inventoryId>0 && quantity>0) await client.query('INSERT INTO recipes(branch_id,product_id,inventory_item_id,quantity) VALUES($1,$2,$3,$4)',[branchId,productId,inventoryId,quantity]);
    }
    await client.query('COMMIT');res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});

async function createSale({branchId,userId,method,items,source='pos',fixedItems=null}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const inputItems = fixedItems || items;
    const ids=inputItems.map(x=>Number(x.productId)).filter(Boolean);
    if(!ids.length) throw Object.assign(new Error('Выберите товар'),{status:400});
    const {rows:products}=await client.query('SELECT id,name,price,active FROM products WHERE id=ANY($1::int[])',[ids]);
    const map=new Map(products.map(p=>[Number(p.id),p]));
    let total=0;
    const normalized=[];
    for(const raw of inputItems){
      const dbProduct=map.get(Number(raw.productId));
      const quantity=Math.max(1,Math.floor(Number(raw.quantity)||1));
      if(!dbProduct) throw Object.assign(new Error('Один из товаров недоступен'),{status:400});
      if(!fixedItems && !dbProduct.active) throw Object.assign(new Error('Один из товаров недоступен'),{status:400});
      const product=fixedItems?{id:dbProduct.id,name:String(raw.name||dbProduct.name),price:Number(raw.price)}:dbProduct;
      if(!Number.isFinite(Number(product.price)) || Number(product.price)<0) throw Object.assign(new Error('Некорректная цена товара'),{status:400});
      total += Number(product.price)*quantity;
      normalized.push({product,quantity});
    }
    const {rows:recipeRows}=await client.query(`SELECT r.product_id,r.inventory_item_id,r.quantity,i.name,i.unit,i.quantity AS stock
      FROM recipes r JOIN inventory_items i ON i.id=r.inventory_item_id
      WHERE r.branch_id=$1 AND r.product_id=ANY($2::int[]) FOR UPDATE OF i`,[branchId,ids]);
    const need=new Map();
    for(const item of normalized){
      for(const r of recipeRows.filter(x=>Number(x.product_id)===Number(item.product.id))){
        const key=Number(r.inventory_item_id);
        const current=need.get(key)||{amount:0,name:r.name,unit:r.unit,stock:Number(r.stock)};
        current.amount += Number(r.quantity)*item.quantity;
        need.set(key,current);
      }
    }
    for(const [,n] of need){
      if(n.stock < n.amount) throw Object.assign(new Error(`Недостаточно на складе: ${n.name} (нужно ${n.amount} ${n.unit})`),{status:400});
    }
    const sale=(await client.query('INSERT INTO sales(branch_id,user_id,method,total,source) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',[branchId,userId||null,method,total,source])).rows[0];
    for(const [inventoryId,n] of need){
      await client.query('UPDATE inventory_items SET quantity=quantity-$1 WHERE id=$2 AND branch_id=$3',[n.amount,inventoryId,branchId]);
      await client.query(`INSERT INTO inventory_movements(branch_id,inventory_item_id,item_name_snapshot,type,quantity,reason,sale_id,user_id) VALUES($1,$2,$3,'sale',$4,$5,$6,$7)`,[branchId,inventoryId,n.name,n.amount,`Продажа №${sale.id}`,sale.id,userId||null]);
    }
    for(const item of normalized){
      await client.query('INSERT INTO sale_items(sale_id,product_id,name_snapshot,price,quantity) VALUES($1,$2,$3,$4,$5)',[sale.id,item.product.id,item.product.name,item.product.price,item.quantity]);
    }
    await client.query('COMMIT');
    return {id:sale.id,total,createdAt:sale.created_at};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

app.post('/api/sale', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), method=String(req.body.method||'');
  if(!['cash','card'].includes(method)) return res.status(400).json({error:'Выберите способ оплаты'});
  try{
    const sale=await createSale({branchId,userId:req.user.id,method,items:Array.isArray(req.body.items)?req.body.items:[],source:'pos'});
    res.json({ok:true,sale});
  }catch(e){res.status(e.status||500).json({error:e.message||'Ошибка продажи'});}
});

app.post('/api/cash', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), amount=Math.round(Number(req.body.amount)), type=String(req.body.type||''), reason=String(req.body.reason||'').trim();
  if(!['cash_in','cash_out'].includes(type) || !amount || amount<=0) return res.status(400).json({error:'Некорректная сумма'});
  if(type==='cash_out' && req.user.role==='cashier') return res.status(403).json({error:'Изъятие денег доступно владельцу или администратору'});
  if(type==='cash_out' && !reason) return res.status(400).json({error:'Укажите причину расхода'});
  await pool.query('INSERT INTO cash_operations(branch_id,user_id,type,amount,reason) VALUES($1,$2,$3,$4,$5)',[branchId,req.user.id,type,amount,reason]);
  res.json({ok:true});
});

app.get('/api/dashboard', auth, async (req,res)=>{
  const branchId=await resolveBranch(req);
  const summary=(await pool.query(`SELECT
      COALESCE((SELECT SUM(total) FROM sales WHERE branch_id=$1),0)::bigint AS sales,
      COALESCE((SELECT SUM(total) FROM sales WHERE branch_id=$1 AND method='card'),0)::bigint AS card,
      COALESCE((SELECT SUM(total) FROM sales WHERE branch_id=$1 AND method='cash'),0)::bigint
        + COALESCE((SELECT SUM(CASE WHEN type='cash_in' THEN amount ELSE -amount END) FROM cash_operations WHERE branch_id=$1),0)::bigint AS cash,
      COALESCE((SELECT SUM(amount) FROM cash_operations WHERE branch_id=$1 AND type='cash_out'),0)::bigint AS expenses,
      COALESCE((SELECT COUNT(*) FROM online_orders WHERE branch_id=$1 AND status IN ('new','accepted','ready')),0)::int AS pending_orders,
      COALESCE((SELECT COUNT(*) FROM inventory_items WHERE branch_id=$1 AND quantity<=threshold),0)::int AS low_stock`,[branchId])).rows[0];
  const {rows:activity}=await pool.query(`
    SELECT * FROM (
      SELECT 'sale' AS type,s.id,s.total AS amount,'' AS reason,s.method,s.created_at,u.name AS user_name FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.branch_id=$1
      UNION ALL
      SELECT c.type,c.id,c.amount,c.reason,NULL AS method,c.created_at,u.name AS user_name FROM cash_operations c LEFT JOIN users u ON u.id=c.user_id WHERE c.branch_id=$1
    ) q ORDER BY created_at DESC LIMIT 30`,[branchId]);
  res.json({...summary,activity});
});

app.get('/api/reports', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const period=String(req.query.period||'today');
  let fromSql="date_trunc('day',NOW())";
  if(period==='week') fromSql="date_trunc('week',NOW())";
  else if(period==='month') fromSql="date_trunc('month',NOW())";
  else if(period==='30d') fromSql="NOW()-INTERVAL '30 days'";
  const totals=(await pool.query(`SELECT
    COALESCE(SUM(total),0)::bigint AS sales,
    COALESCE(SUM(CASE WHEN method='cash' THEN total ELSE 0 END),0)::bigint AS cash_sales,
    COALESCE(SUM(CASE WHEN method='card' THEN total ELSE 0 END),0)::bigint AS card_sales,
    COUNT(*)::int AS receipts,
    COALESCE(AVG(total),0)::bigint AS average_check
    FROM sales WHERE branch_id=$1 AND created_at>=${fromSql}`,[branchId])).rows[0];
  const expenses=(await pool.query(`SELECT COALESCE(SUM(amount),0)::bigint AS expenses FROM cash_operations WHERE branch_id=$1 AND type='cash_out' AND created_at>=${fromSql}`,[branchId])).rows[0].expenses;
  const {rows:top}=await pool.query(`SELECT si.name_snapshot AS name,SUM(si.quantity)::int AS quantity,SUM(si.price*si.quantity)::bigint AS revenue
    FROM sale_items si JOIN sales s ON s.id=si.sale_id
    WHERE s.branch_id=$1 AND s.created_at>=${fromSql}
    GROUP BY si.name_snapshot ORDER BY revenue DESC LIMIT 8`,[branchId]);
  const {rows:daily}=await pool.query(`SELECT to_char(date_trunc('day',created_at),'DD.MM') AS day,SUM(total)::bigint AS sales
    FROM sales WHERE branch_id=$1 AND created_at>=${fromSql}
    GROUP BY date_trunc('day',created_at) ORDER BY date_trunc('day',created_at)`,[branchId]);
  res.json({...totals,expenses,profit:Number(totals.sales)-Number(expenses),top,daily});
});

app.get('/api/sales', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), limit=Math.min(100,Math.max(1,Number(req.query.limit)||50));
  const {rows}=await pool.query(`SELECT s.id,s.method,s.total,s.source,s.created_at,u.name AS user_name
    FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.branch_id=$1 ORDER BY s.created_at DESC LIMIT $2`,[branchId,limit]);
  res.json(rows);
});

app.get('/api/sales/:id', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id);
  const {rows}=await pool.query(`SELECT s.id,s.method,s.total,s.source,s.created_at,u.name AS user_name,b.name AS branch_name,b.address AS branch_address
    FROM sales s LEFT JOIN users u ON u.id=s.user_id JOIN branches b ON b.id=s.branch_id
    WHERE s.id=$1 AND s.branch_id=$2`,[id,branchId]);
  if(!rows[0]) return res.status(404).json({error:'Чек не найден'});
  const items=(await pool.query('SELECT name_snapshot AS name,price,quantity FROM sale_items WHERE sale_id=$1 ORDER BY id',[id])).rows;
  res.json({...rows[0],items,methodLabel:saleMethodLabel(rows[0].method)});
});

app.get('/api/expenses', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const {rows}=await pool.query(`SELECT c.id,c.amount,c.reason,c.created_at,u.name AS user_name FROM cash_operations c LEFT JOIN users u ON u.id=c.user_id
    WHERE c.branch_id=$1 AND c.type='cash_out' ORDER BY c.created_at DESC LIMIT 100`,[branchId]);
  res.json(rows);
});

app.get('/api/orders', auth, async (req,res)=>{
  const branchId=await resolveBranch(req);
  const {rows}=await pool.query('SELECT id,customer_name,customer_phone,status,total,created_at FROM online_orders WHERE branch_id=$1 ORDER BY created_at DESC LIMIT 100',[branchId]);
  res.json(rows);
});

app.get('/api/orders/:id', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id);
  const {rows}=await pool.query('SELECT * FROM online_orders WHERE id=$1 AND branch_id=$2',[id,branchId]);
  if(!rows[0]) return res.status(404).json({error:'Заказ не найден'});
  const items=(await pool.query('SELECT product_id,name_snapshot AS name,price,quantity FROM online_order_items WHERE order_id=$1 ORDER BY id',[id])).rows;
  res.json({...rows[0],items});
});

app.put('/api/orders/:id/status', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id), status=String(req.body.status||'');
  if(!['new','accepted','ready','completed','cancelled'].includes(status)) return res.status(400).json({error:'Некорректный статус'});
  const order=(await pool.query('SELECT * FROM online_orders WHERE id=$1 AND branch_id=$2',[id,branchId])).rows[0];
  if(!order) return res.status(404).json({error:'Заказ не найден'});
  if(status==='completed'){
    if(order.status==='completed') return res.json({ok:true,alreadyCompleted:true});
    if(order.status==='cancelled') return res.status(400).json({error:'Отменённый заказ нельзя завершить'});
    const method=String(req.body.paymentMethod||'');
    if(!['cash','card'].includes(method)) return res.status(400).json({error:'Выберите способ оплаты'});
    const orderItems=(await pool.query('SELECT product_id AS "productId",name_snapshot AS name,price,quantity FROM online_order_items WHERE order_id=$1',[id])).rows;
    try{
      const sale=await createSale({branchId,userId:req.user.id,method,items:[],fixedItems:orderItems,source:`online_order:${id}`});
      await pool.query("UPDATE online_orders SET status='completed' WHERE id=$1 AND branch_id=$2",[id,branchId]);
      return res.json({ok:true,sale});
    }catch(e){return res.status(e.status||500).json({error:e.message||'Не удалось завершить заказ'});}
  }
  if(order.status==='completed') return res.status(400).json({error:'Завершённый заказ нельзя изменить'});
  await pool.query('UPDATE online_orders SET status=$1 WHERE id=$2 AND branch_id=$3',[status,id,branchId]);
  res.json({ok:true});
});

app.get('/api/customer-qr', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const origin=PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const url=`${origin}/menu.html?branch=${branchId}`;
  const dataUrl=await QRCode.toDataURL(url,{width:360,margin:2});
  res.json({url,dataUrl});
});

app.get('/api/public/branches', async (req,res)=>{
  const {rows}=await pool.query('SELECT id,name,address FROM branches WHERE active=true ORDER BY id');
  res.json(rows);
});

app.get('/api/public/products', async (req,res)=>{
  const branchId=Number(req.query.branch||0);
  if(branchId){
    const ok=(await pool.query('SELECT id FROM branches WHERE id=$1 AND active=true',[branchId])).rows[0];
    if(!ok) return res.status(404).json({error:'Филиал не найден'});
  }
  res.json((await pool.query('SELECT id,name,category,price FROM products WHERE active=true ORDER BY category,name')).rows);
});

app.post('/api/public/orders', orderLimiter, async (req,res)=>{
  const branchId=Number(req.body.branchId), customerName=String(req.body.customerName||'').trim().slice(0,80), customerPhone=String(req.body.customerPhone||'').trim().slice(0,40), items=Array.isArray(req.body.items)?req.body.items:[];
  if(!branchId || !customerName || !customerPhone || !items.length) return res.status(400).json({error:'Заполните имя, телефон и выберите товары'});
  const branch=(await pool.query('SELECT id FROM branches WHERE id=$1 AND active=true',[branchId])).rows[0];
  if(!branch) return res.status(400).json({error:'Филиал недоступен'});
  const ids=items.map(x=>Number(x.productId)).filter(Boolean);
  const {rows:products}=await pool.query('SELECT id,name,price FROM products WHERE active=true AND id=ANY($1::int[])',[ids]);
  const map=new Map(products.map(p=>[Number(p.id),p]));
  const normalized=[]; let total=0;
  for(const raw of items){
    const p=map.get(Number(raw.productId)); const quantity=Math.min(20,Math.max(1,Math.floor(Number(raw.quantity)||1)));
    if(!p) return res.status(400).json({error:'Один из товаров недоступен'});
    total += Number(p.price)*quantity; normalized.push({p,quantity});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const order=(await client.query('INSERT INTO online_orders(branch_id,customer_name,customer_phone,total) VALUES($1,$2,$3,$4) RETURNING id,total,status,created_at',[branchId,customerName,customerPhone,total])).rows[0];
    for(const item of normalized) await client.query('INSERT INTO online_order_items(order_id,product_id,name_snapshot,price,quantity) VALUES($1,$2,$3,$4,$5)',[order.id,item.p.id,item.p.name,item.p.price,item.quantity]);
    await client.query('COMMIT');
    res.json({ok:true,order});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});

app.get('/api/export', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=req.user.role==='owner' ? null : await resolveBranch(req);
  const data={exportedAt:new Date().toISOString(),version:'7.0.0'};
  if(branchId){
    data.branches=(await pool.query('SELECT id,name,address,active,created_at FROM branches WHERE id=$1',[branchId])).rows;
    data.users=(await pool.query('SELECT id,username,name,role,branch_id,active,created_at FROM users WHERE branch_id=$1',[branchId])).rows;
    data.products=(await pool.query('SELECT * FROM products ORDER BY id')).rows;
    data.inventory=(await pool.query('SELECT * FROM inventory_items WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.recipes=(await pool.query('SELECT * FROM recipes WHERE branch_id=$1 ORDER BY product_id,inventory_item_id',[branchId])).rows;
    data.sales=(await pool.query('SELECT * FROM sales WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.saleItems=(await pool.query('SELECT si.* FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.branch_id=$1 ORDER BY si.id',[branchId])).rows;
    data.cashOperations=(await pool.query('SELECT * FROM cash_operations WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.onlineOrders=(await pool.query('SELECT * FROM online_orders WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.onlineOrderItems=(await pool.query('SELECT oi.* FROM online_order_items oi JOIN online_orders o ON o.id=oi.order_id WHERE o.branch_id=$1 ORDER BY oi.id',[branchId])).rows;
    data.inventoryMovements=(await pool.query('SELECT * FROM inventory_movements WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
  }else{
    data.branches=(await pool.query('SELECT * FROM branches ORDER BY id')).rows;
    data.users=(await pool.query('SELECT id,username,name,role,branch_id,active,created_at FROM users ORDER BY id')).rows;
    data.products=(await pool.query('SELECT * FROM products ORDER BY id')).rows;
    data.inventory=(await pool.query('SELECT * FROM inventory_items ORDER BY id')).rows;
    data.recipes=(await pool.query('SELECT * FROM recipes ORDER BY branch_id,product_id,inventory_item_id')).rows;
    data.sales=(await pool.query('SELECT * FROM sales ORDER BY id')).rows;
    data.saleItems=(await pool.query('SELECT * FROM sale_items ORDER BY id')).rows;
    data.cashOperations=(await pool.query('SELECT * FROM cash_operations ORDER BY id')).rows;
    data.onlineOrders=(await pool.query('SELECT * FROM online_orders ORDER BY id')).rows;
    data.onlineOrderItems=(await pool.query('SELECT * FROM online_order_items ORDER BY id')).rows;
    data.inventoryMovements=(await pool.query('SELECT * FROM inventory_movements ORDER BY id')).rows;
  }
  const stamp=new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="coffee-export-${stamp}.json"`);
  res.send(JSON.stringify(data,null,2));
});

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

initDb().then(() => {
  app.listen(PORT, HOST, () => console.log(`Coffee System v7: http://${HOST}:${PORT}`));
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
