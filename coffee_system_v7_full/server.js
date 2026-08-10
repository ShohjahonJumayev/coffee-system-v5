const express = require('express');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const multer = require('multer');
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
const PAYME_MERCHANT_ID = String(process.env.PAYME_MERCHANT_ID || '').trim();
const PAYME_LOGIN = String(process.env.PAYME_LOGIN || '').trim();
const PAYME_KEY = String(process.env.PAYME_KEY || '').trim();
const PAYME_TEST_KEY = String(process.env.PAYME_TEST_KEY || '').trim();
const PAYME_TEST_MODE = String(process.env.PAYME_TEST_MODE || 'false').toLowerCase() === 'true';
const PAYME_ACCOUNT_FIELD = 'order_id';
const YANDEX_MAPS_API_KEY = String(process.env.YANDEX_MAPS_API_KEY || '').trim();
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim();
const CARD_TRANSFER_NUMBER = String(process.env.CARD_TRANSFER_NUMBER || '').trim();
const CARD_TRANSFER_HOLDER = String(process.env.CARD_TRANSFER_HOLDER || '').trim();
const FIRST_ORDER_PROMO_CODE = String(process.env.FIRST_ORDER_PROMO_CODE || 'FIRST10').trim().toUpperCase();
const FIRST_ORDER_PROMO_PERCENT = Number(process.env.FIRST_ORDER_PROMO_PERCENT || 10) || 10;
const TELEGRAM_VERIFY_TTL_MINUTES = 10;
const BUSINESS_TIMEZONE = 'Asia/Tashkent';
const BUSINESS_OPEN_HOUR = 8;
const BUSINESS_CLOSE_HOUR = 1;
const TELEGRAM_WEBHOOK_SECRET = crypto.createHash('sha256').update(SESSION_SECRET || 'in-coffee').digest('hex');

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

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp'].includes(file.mimetype))
});

const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });
const verificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Слишком много запросов подтверждения. Попробуйте позже.' } });

function tashkentClock(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second)
  };
}

function onlineOrderingOpen(date = new Date()) {
  const { hour } = tashkentClock(date);
  return hour >= BUSINESS_OPEN_HOUR || hour < BUSINESS_CLOSE_HOUR;
}

function operationalBusinessDate(date = new Date()) {
  const c = tashkentClock(date);
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day, 12, 0, 0));
  if (c.hour < BUSINESS_OPEN_HOUR) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function publicBusinessStatus() {
  const c = tashkentClock();
  const open = onlineOrderingOpen();
  return {
    open,
    timezone: BUSINESS_TIMEZONE,
    hours: '08:00–01:00',
    openHour: '08:00',
    closeHour: '01:00',
    localTime: `${String(c.hour).padStart(2,'0')}:${String(c.minute).padStart(2,'0')}`,
    businessDate: operationalBusinessDate(),
    message: open ? 'Онлайн-заказы принимаются' : 'Онлайн-заказы сейчас закрыты. Откроемся в 08:00.'
  };
}

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

function setCustomerCookie(res, token) {
  const attrs = [
    `customer_token=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${30 * 24 * 60 * 60}`,
  ];
  if (NODE_ENV === 'production') attrs.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, attrs.join('; ')) : attrs.join('; '));
}

function clearCustomerCookie(res) {
  const attrs = ['customer_token=', 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (NODE_ENV === 'production') attrs.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, attrs.join('; ')) : attrs.join('; '));
}

function signCustomer(customer) {
  return jwt.sign({ id: customer.id, kind: 'customer' }, SESSION_SECRET, { expiresIn: '30d' });
}

function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 9) digits = '998' + digits;
  if (digits.length < 9 || digits.length > 15) return null;
  return '+' + digits;
}

function normalizeCustomerPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 9) digits = '998' + digits;
  if (!/^998\d{9}$/.test(digits)) return null;
  return '+' + digits;
}

function telegramConfigured() {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_USERNAME && PUBLIC_URL);
}

async function telegramApi(method, body = {}) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('Telegram-бот не настроен');
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram API: ${method} failed`);
  return data.result;
}

async function setupTelegramWebhook() {
  if (!telegramConfigured()) return;
  try {
    await telegramApi('setWebhook', {
      url: `${PUBLIC_URL}/api/telegram/webhook`,
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
      drop_pending_updates: false
    });
    console.log('Telegram verification webhook configured');
  } catch (e) {
    console.error('Telegram webhook setup failed:', e.message);
  }
}

async function sendTelegramMessage(chatId, text, replyMarkup) {
  const body = { chat_id: chatId, text };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramApi('sendMessage', body);
}

function telegramVerificationToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function createTelegramVerification({ phone, purpose, payload = {}, customerId = null }) {
  if (!telegramConfigured()) {
    const error = new Error('Подтверждение через Telegram пока не подключено. Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_BOT_USERNAME в Render.');
    error.status = 503;
    throw error;
  }
  await pool.query('DELETE FROM customer_telegram_verifications WHERE expires_at < NOW()');
  const recent = Number((await pool.query(`SELECT COUNT(*)::int AS c FROM customer_telegram_verifications WHERE phone=$1 AND created_at > NOW() - INTERVAL '15 minutes'`, [phone])).rows[0].c || 0);
  if (recent >= 5) {
    const error = new Error('Слишком много попыток подтверждения. Попробуйте позже.');
    error.status = 429;
    throw error;
  }
  const token = telegramVerificationToken();
  const expiresAt = new Date(Date.now() + TELEGRAM_VERIFY_TTL_MINUTES * 60 * 1000);
  await pool.query(`INSERT INTO customer_telegram_verifications(token,purpose,phone,customer_id,payload,expires_at)
    VALUES($1,$2,$3,$4,$5,$6)`, [token,purpose,phone,customerId,JSON.stringify(payload),expiresAt]);
  return {
    ok: true,
    token,
    telegramUrl: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`,
    expiresIn: TELEGRAM_VERIFY_TTL_MINUTES * 60,
    provider: 'Telegram'
  };
}

async function getTelegramVerification(token, purpose) {
  const value = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(value)) return null;
  const { rows } = await pool.query(`SELECT * FROM customer_telegram_verifications WHERE token=$1 AND purpose=$2`, [value,purpose]);
  return rows[0] || null;
}

async function getAppSetting(key) {
  const { rows } = await pool.query('SELECT value FROM app_settings WHERE key=$1',[key]);
  return rows[0]?.value ?? '';
}

async function setAppSetting(key, value) {
  await pool.query(`INSERT INTO app_settings(key,value,updated_at) VALUES($1,$2,NOW())
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`,[key,String(value||'')]);
}

async function effectiveCardTransferSettings() {
  const [dbNumber,dbHolder] = await Promise.all([getAppSetting('card_transfer_number'),getAppSetting('card_transfer_holder')]);
  const cardNumber = String(dbNumber || CARD_TRANSFER_NUMBER || '').trim();
  const cardHolder = String(dbHolder || CARD_TRANSFER_HOLDER || '').trim();
  return { configured:Boolean(cardNumber), cardNumber, cardHolder };
}

async function effectiveYandexMapsSettings() {
  const dbKey = await getAppSetting('yandex_maps_api_key');
  const apiKey = String(dbKey || YANDEX_MAPS_API_KEY || '').trim();
  return { configured:Boolean(apiKey), apiKey };
}

async function customerFirstOrderEligible(customerId, db = pool) {
  const q = typeof db.query === 'function' ? db : pool;
  const { rows } = await q.query('SELECT COUNT(*)::int AS count FROM online_orders WHERE customer_id=$1', [customerId]);
  return Number(rows[0]?.count || 0) === 0;
}

async function enrichCustomer(customer, db = pool) {
  if (!customer?.id) return customer;
  return { ...customer, first_order_eligible: await customerFirstOrderEligible(customer.id, db), first_order_promo_code: FIRST_ORDER_PROMO_CODE, first_order_promo_percent: FIRST_ORDER_PROMO_PERCENT };
}

async function customerAuth(req, res, next) {
  try {
    const token = cookieValue(req, 'customer_token');
    if (!token) return res.status(401).json({ error: 'Войдите в аккаунт клиента' });
    const data = jwt.verify(token, SESSION_SECRET);
    if (data.kind !== 'customer') return res.status(401).json({ error: 'Неверная сессия' });
    const { rows } = await pool.query('SELECT id,name,phone,phone_verified,active,created_at FROM customer_accounts WHERE id=$1', [data.id]);
    const customer = rows[0];
    if (!customer || !customer.active) return res.status(401).json({ error: 'Аккаунт недоступен' });
    req.customer = customer;
    next();
  } catch {
    return res.status(401).json({ error: 'Сессия клиента истекла' });
  }
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


function originFor(req) {
  return PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

function paymeSecret() {
  return PAYME_TEST_MODE ? PAYME_TEST_KEY : PAYME_KEY;
}

function paymeConfigured() {
  return Boolean(PAYME_MERCHANT_ID && PAYME_LOGIN && paymeSecret());
}

function paymeCheckoutUrl(orderId, totalSum, branchId, req) {
  if (!paymeConfigured()) return null;
  const checkoutBase = PAYME_TEST_MODE ? 'https://test.paycom.uz' : 'https://checkout.paycom.uz';
  const callback = `${originFor(req)}/menu.html?branch=${Number(branchId)}&payment_order=${Number(orderId)}`;
  const params = [
    `m=${PAYME_MERCHANT_ID}`,
    `ac.${PAYME_ACCOUNT_FIELD}=${Number(orderId)}`,
    `a=${Math.round(Number(totalSum) * 100)}`,
    'l=ru',
    `c=${encodeURIComponent(callback)}`,
    'ct=2500'
  ].join(';');
  return `${checkoutBase}/${Buffer.from(params, 'utf8').toString('base64')}`;
}

function paymeRpcError(id, code, ru, data) {
  const error = { code, message: { ru, uz: ru, en: ru } };
  if (data !== undefined) error.data = data;
  return { error, id: id ?? null };
}

function paymeRpcResult(id, result) {
  return { result, id: id ?? null };
}

function parseBasicAuth(req) {
  const raw = String(req.headers.authorization || '');
  if (!raw.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(raw.slice(6), 'base64').toString('utf8');
    const pos = decoded.indexOf(':');
    if (pos < 0) return null;
    return { login: decoded.slice(0,pos), password: decoded.slice(pos+1) };
  } catch { return null; }
}

function productSelect(prefix='') {
  const p = prefix ? prefix + '.' : '';
  return `${p}id,${p}name,${p}category,${p}price,${p}active,CASE WHEN ${p}image_data IS NOT NULL THEN '/media/products/'||${p}id ELSE '' END AS image_url`;
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
        image_mime TEXT,
        image_data BYTEA,
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
      CREATE TABLE IF NOT EXISTS cash_shifts (
        id BIGSERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
        business_date DATE NOT NULL,
        opened_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        closed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        closed_at TIMESTAMPTZ,
        closing_total_sales BIGINT NOT NULL DEFAULT 0,
        closing_cash_sales BIGINT NOT NULL DEFAULT 0,
        closing_card_sales BIGINT NOT NULL DEFAULT 0,
        closing_online_sales BIGINT NOT NULL DEFAULT 0,
        closing_cash_in BIGINT NOT NULL DEFAULT 0,
        closing_cash_out BIGINT NOT NULL DEFAULT 0,
        closing_expenses BIGINT NOT NULL DEFAULT 0,
        closing_net_cash BIGINT NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_cash_shift_per_branch ON cash_shifts(branch_id) WHERE closed_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_cash_shifts_branch_date ON cash_shifts(branch_id,business_date DESC,opened_at DESC);
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS customer_accounts (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS customer_sms_verifications (
        phone TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('register','verify_existing')),
        code_hash TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        send_count INTEGER NOT NULL DEFAULT 0,
        window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resend_available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(phone,purpose)
      );
      CREATE TABLE IF NOT EXISTS customer_telegram_verifications (
        token TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK (purpose IN ('register','verify_existing')),
        phone TEXT NOT NULL,
        customer_id BIGINT REFERENCES customer_accounts(id) ON DELETE CASCADE,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        telegram_user_id BIGINT,
        telegram_chat_id BIGINT,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_telegram_verify_phone_created ON customer_telegram_verifications(phone,created_at DESC);
      CREATE TABLE IF NOT EXISTS online_orders (
        id BIGSERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES branches(id),
        customer_id BIGINT REFERENCES customer_accounts(id) ON DELETE SET NULL,
        customer_name TEXT NOT NULL,
        customer_phone TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','accepted','ready','completed','cancelled')),
        total BIGINT NOT NULL CHECK (total >= 0),
        payment_method TEXT NOT NULL DEFAULT 'cash',
        payment_status TEXT NOT NULL DEFAULT 'unpaid',
        paid_at TIMESTAMPTZ,
        payment_receipt_mime TEXT,
        payment_receipt_data BYTEA,
        payment_reviewed_at TIMESTAMPTZ,
        payment_reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        delivery_type TEXT NOT NULL DEFAULT 'delivery',
        delivery_address TEXT NOT NULL DEFAULT '',
        delivery_lat DOUBLE PRECISION,
        delivery_lng DOUBLE PRECISION,
        delivery_comment TEXT NOT NULL DEFAULT '',
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
      CREATE TABLE IF NOT EXISTS payme_transactions (
        payme_id TEXT PRIMARY KEY,
        order_id BIGINT NOT NULL REFERENCES online_orders(id) ON DELETE CASCADE,
        time_ms BIGINT NOT NULL,
        amount_tiyin BIGINT NOT NULL,
        create_time_ms BIGINT NOT NULL,
        perform_time_ms BIGINT NOT NULL DEFAULT 0,
        cancel_time_ms BIGINT NOT NULL DEFAULT 0,
        state INTEGER NOT NULL DEFAULT 1,
        reason INTEGER,
        fiscal_perform JSONB,
        fiscal_cancel JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_payme_order ON payme_transactions(order_id);
      CREATE INDEX IF NOT EXISTS idx_payme_time ON payme_transactions(time_ms);
      CREATE INDEX IF NOT EXISTS idx_sales_branch_created ON sales(branch_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_cash_branch_created ON cash_operations(branch_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_branch_created ON online_orders(branch_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inventory_branch ON inventory_items(branch_id);
      CREATE INDEX IF NOT EXISTS idx_inventory_movements_branch_created ON inventory_movements(branch_id,created_at DESC);
    `);

    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS image_mime TEXT;
      ALTER TABLE products ADD COLUMN IF NOT EXISTS image_data BYTEA;
      ALTER TABLE sales ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES cash_shifts(id) ON DELETE SET NULL;
      ALTER TABLE cash_operations ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES cash_shifts(id) ON DELETE SET NULL;
      ALTER TABLE customer_accounts ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES customer_accounts(id) ON DELETE SET NULL;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash';
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_receipt_mime TEXT;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_receipt_data BYTEA;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_reviewed_at TIMESTAMPTZ;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS payment_reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS delivery_type TEXT NOT NULL DEFAULT 'delivery';
      ALTER TABLE online_orders ALTER COLUMN delivery_type SET DEFAULT 'delivery';
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS delivery_address TEXT NOT NULL DEFAULT '';
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION;
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS delivery_comment TEXT NOT NULL DEFAULT '';
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS promo_code TEXT NOT NULL DEFAULT '';
      ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS discount_amount BIGINT NOT NULL DEFAULT 0;
      CREATE INDEX IF NOT EXISTS idx_orders_customer_created ON online_orders(customer_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_customer_phone ON customer_accounts(phone);
    `);
    await client.query("UPDATE branches SET name='In coffee' WHERE name='Основной филиал'");

    const branchCount = Number((await client.query('SELECT COUNT(*)::int AS c FROM branches')).rows[0].c);
    if (branchCount === 0) {
      await client.query("INSERT INTO branches(name,address) VALUES('In coffee','')");
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
    res.json({ ok: true, service: 'in-coffee-v10', database: 'ok' });
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
  res.json((await pool.query(`SELECT ${productSelect()} FROM products WHERE active=true ORDER BY category,name`)).rows);
});

app.get('/api/products/all', auth, allow('owner','admin'), async (req, res) => {
  res.json((await pool.query(`SELECT ${productSelect()} FROM products ORDER BY active DESC,category,name`)).rows);
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

app.get('/media/products/:id', async (req,res)=>{
  const id=Number(req.params.id);
  const {rows}=await pool.query('SELECT image_mime,image_data FROM products WHERE id=$1',[id]);
  const p=rows[0];
  if(!p || !p.image_data) return res.status(404).end();
  res.setHeader('Content-Type',p.image_mime||'image/jpeg');
  res.setHeader('Cache-Control','no-store');
  res.send(p.image_data);
});

app.post('/api/products/:id/image', auth, allow('owner','admin'), imageUpload.single('image'), async (req,res)=>{
  const id=Number(req.params.id);
  if(!req.file) return res.status(400).json({error:'Выберите JPG, PNG или WebP фото'});
  const {rows}=await pool.query('UPDATE products SET image_mime=$1,image_data=$2 WHERE id=$3 RETURNING id',[req.file.mimetype,req.file.buffer,id]);
  if(!rows[0]) return res.status(404).json({error:'Товар не найден'});
  res.json({ok:true,imageUrl:`/media/products/${id}?v=${Date.now()}`});
});

app.delete('/api/products/:id/image', auth, allow('owner','admin'), async (req,res)=>{
  const id=Number(req.params.id);
  const result=await pool.query('UPDATE products SET image_mime=NULL,image_data=NULL WHERE id=$1',[id]);
  if(!result.rowCount) return res.status(404).json({error:'Товар не найден'});
  res.json({ok:true});
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

async function getOpenCashShift(branchId, db = pool, lockMode = '') {
  const suffix = lockMode === 'update' ? ' FOR UPDATE' : lockMode === 'share' ? ' FOR SHARE' : '';
  const { rows } = await db.query(`SELECT id,branch_id,business_date,opened_by,opened_at,closed_at FROM cash_shifts WHERE branch_id=$1 AND closed_at IS NULL ORDER BY id DESC LIMIT 1${suffix}`,[branchId]);
  return rows[0] || null;
}

async function cashShiftSummary(shiftId, db = pool) {
  const sales=(await db.query(`SELECT
    COALESCE(SUM(total),0)::bigint AS total_sales,
    COALESCE(SUM(CASE WHEN method='cash' THEN total ELSE 0 END),0)::bigint AS cash_sales,
    COALESCE(SUM(CASE WHEN method='card' THEN total ELSE 0 END),0)::bigint AS card_sales,
    COALESCE(SUM(CASE WHEN method='online' THEN total ELSE 0 END),0)::bigint AS online_sales,
    COUNT(*)::int AS receipts
    FROM sales WHERE shift_id=$1`,[shiftId])).rows[0];
  const cash=(await db.query(`SELECT
    COALESCE(SUM(CASE WHEN type='cash_in' THEN amount ELSE 0 END),0)::bigint AS cash_in,
    COALESCE(SUM(CASE WHEN type='cash_out' THEN amount ELSE 0 END),0)::bigint AS cash_out
    FROM cash_operations WHERE shift_id=$1`,[shiftId])).rows[0];
  const totalSales=Number(sales.total_sales||0), cashSales=Number(sales.cash_sales||0), cashIn=Number(cash.cash_in||0), cashOut=Number(cash.cash_out||0);
  return {
    total_sales: totalSales,
    cash_sales: cashSales,
    card_sales: Number(sales.card_sales||0),
    online_sales: Number(sales.online_sales||0),
    receipts: Number(sales.receipts||0),
    cash_in: cashIn,
    cash_out: cashOut,
    expenses: cashOut,
    profit_after_expenses: totalSales - cashOut,
    cash_balance_from_shift: cashSales + cashIn - cashOut
  };
}

function emptyCashShiftSummary(){
  return {total_sales:0,cash_sales:0,card_sales:0,online_sales:0,receipts:0,cash_in:0,cash_out:0,expenses:0,profit_after_expenses:0,cash_balance_from_shift:0};
}

async function businessDaySummary(branchId, businessDate, db = pool) {
  const { rows } = await db.query('SELECT id FROM cash_shifts WHERE branch_id=$1 AND business_date=$2 ORDER BY id',[branchId,businessDate]);
  if(!rows.length) return {total_sales:0,cash_sales:0,card_sales:0,online_sales:0,receipts:0,cash_in:0,cash_out:0,expenses:0,profit_after_expenses:0,cash_balance_from_shift:0};
  const ids=rows.map(x=>Number(x.id));
  const sales=(await db.query(`SELECT
    COALESCE(SUM(total),0)::bigint AS total_sales,
    COALESCE(SUM(CASE WHEN method='cash' THEN total ELSE 0 END),0)::bigint AS cash_sales,
    COALESCE(SUM(CASE WHEN method='card' THEN total ELSE 0 END),0)::bigint AS card_sales,
    COALESCE(SUM(CASE WHEN method='online' THEN total ELSE 0 END),0)::bigint AS online_sales,
    COUNT(*)::int AS receipts FROM sales WHERE shift_id=ANY($1::bigint[])`,[ids])).rows[0];
  const cash=(await db.query(`SELECT
    COALESCE(SUM(CASE WHEN type='cash_in' THEN amount ELSE 0 END),0)::bigint AS cash_in,
    COALESCE(SUM(CASE WHEN type='cash_out' THEN amount ELSE 0 END),0)::bigint AS cash_out FROM cash_operations WHERE shift_id=ANY($1::bigint[])`,[ids])).rows[0];
  const totalSales=Number(sales.total_sales||0), cashSales=Number(sales.cash_sales||0), cashIn=Number(cash.cash_in||0), cashOut=Number(cash.cash_out||0);
  return {total_sales:totalSales,cash_sales:cashSales,card_sales:Number(sales.card_sales||0),online_sales:Number(sales.online_sales||0),receipts:Number(sales.receipts||0),cash_in:cashIn,cash_out:cashOut,expenses:cashOut,profit_after_expenses:totalSales-cashOut,cash_balance_from_shift:cashSales+cashIn-cashOut};
}

async function createSale({branchId,userId,method,items,source='pos',fixedItems=null}){
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const shift=await getOpenCashShift(branchId,client,'share');
    if(!shift) throw Object.assign(new Error('Касса закрыта. Сначала откройте смену'),{status:400});
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
    const sale=(await client.query('INSERT INTO sales(branch_id,user_id,method,total,source,shift_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at',[branchId,userId||null,method,total,source,shift.id])).rows[0];
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
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const shift=await getOpenCashShift(branchId,client,'share');
    if(!shift){await client.query('ROLLBACK');return res.status(400).json({error:'Касса закрыта. Сначала откройте смену'});}
    await client.query('INSERT INTO cash_operations(branch_id,user_id,type,amount,reason,shift_id) VALUES($1,$2,$3,$4,$5,$6)',[branchId,req.user.id,type,amount,reason,shift.id]);
    await client.query('COMMIT');
    res.json({ok:true});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release()}
});

app.get('/api/cash-shift', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), businessDate=operationalBusinessDate();
  const openShift=await getOpenCashShift(branchId);
  const openSummary=openShift?await cashShiftSummary(openShift.id):emptyCashShiftSummary();
  const lastClosed=(await pool.query(`SELECT id,business_date,opened_at,closed_at,closing_total_sales,closing_cash_sales,closing_card_sales,closing_online_sales,closing_cash_in,closing_cash_out,closing_expenses,closing_net_cash
    FROM cash_shifts WHERE branch_id=$1 AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1`,[branchId])).rows[0]||null;
  res.json({open:Boolean(openShift),shift:openShift?{...openShift,summary:openSummary}:null,businessDate,current:openSummary,today:openSummary,lastClosed});
});

app.post('/api/cash-shift/open', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), businessDate=operationalBusinessDate();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const exists=await getOpenCashShift(branchId,client,'update');
    if(exists){await client.query('ROLLBACK');return res.status(409).json({error:'Касса уже открыта'});}
    const {rows}=await client.query('INSERT INTO cash_shifts(branch_id,business_date,opened_by) VALUES($1,$2,$3) RETURNING id,branch_id,business_date,opened_at',[branchId,businessDate,req.user.id]);
    await client.query('COMMIT');
    res.json({ok:true,shift:rows[0],summary:await cashShiftSummary(rows[0].id)});
  }catch(e){
    await client.query('ROLLBACK');
    if(e.code==='23505') return res.status(409).json({error:'Касса уже открыта'});
    throw e;
  }finally{client.release()}
});

app.post('/api/cash-shift/close', auth, async (req,res)=>{
  const branchId=await resolveBranch(req);
  const client=await pool.connect();
  let committed=false;
  try{
    await client.query('BEGIN');
    const shift=await getOpenCashShift(branchId,client,'update');
    if(!shift){await client.query('ROLLBACK');return res.status(400).json({error:'Касса уже закрыта'});}
    const summary=await cashShiftSummary(shift.id,client);
    const expenses=(await client.query(`SELECT id,amount,reason,created_at FROM cash_operations WHERE shift_id=$1 AND type='cash_out' ORDER BY created_at,id`,[shift.id])).rows;
    const {rows}=await client.query(`UPDATE cash_shifts SET closed_at=NOW(),closed_by=$1,
      closing_total_sales=$2,closing_cash_sales=$3,closing_card_sales=$4,closing_online_sales=$5,
      closing_cash_in=$6,closing_cash_out=$7,closing_expenses=$8,closing_net_cash=$9
      WHERE id=$10 RETURNING id,business_date,opened_at,closed_at`,[
        req.user.id,summary.total_sales,summary.cash_sales,summary.card_sales,summary.online_sales,
        summary.cash_in,summary.cash_out,summary.expenses,summary.cash_balance_from_shift,shift.id
      ]);
    await client.query('COMMIT');
    committed=true;
    res.json({ok:true,shift:rows[0],summary,expenses,current:emptyCashShiftSummary()});
  }catch(e){if(!committed){try{await client.query('ROLLBACK')}catch{}}throw e;}finally{client.release()}
});


app.get('/api/cash-shifts', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const limit=Math.min(200,Math.max(1,Number(req.query.limit)||60));
  const {rows}=await pool.query(`SELECT s.id,s.business_date,s.opened_at,s.closed_at,
      s.closing_total_sales,s.closing_cash_sales,s.closing_card_sales,s.closing_online_sales,
      s.closing_cash_in,s.closing_cash_out,s.closing_expenses,s.closing_net_cash,
      ou.name AS opened_by_name,cu.name AS closed_by_name,
      COALESCE((SELECT COUNT(*) FROM sales x WHERE x.shift_id=s.id),0)::int AS receipts_count,
      COALESCE((SELECT COUNT(*) FROM cash_operations c WHERE c.shift_id=s.id AND c.type='cash_out'),0)::int AS expenses_count
    FROM cash_shifts s
    LEFT JOIN users ou ON ou.id=s.opened_by
    LEFT JOIN users cu ON cu.id=s.closed_by
    WHERE s.branch_id=$1 AND s.closed_at IS NOT NULL
    ORDER BY s.closed_at DESC LIMIT $2`,[branchId,limit]);
  res.json(rows);
});

app.get('/api/cash-shifts/:id', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id);
  const shift=(await pool.query(`SELECT s.id,s.business_date,s.opened_at,s.closed_at,
      s.closing_total_sales,s.closing_cash_sales,s.closing_card_sales,s.closing_online_sales,
      s.closing_cash_in,s.closing_cash_out,s.closing_expenses,s.closing_net_cash,
      ou.name AS opened_by_name,cu.name AS closed_by_name
    FROM cash_shifts s
    LEFT JOIN users ou ON ou.id=s.opened_by
    LEFT JOIN users cu ON cu.id=s.closed_by
    WHERE s.id=$1 AND s.branch_id=$2 AND s.closed_at IS NOT NULL`,[id,branchId])).rows[0];
  if(!shift) return res.status(404).json({error:'Закрытая смена не найдена'});
  const sales=(await pool.query(`SELECT s.id,s.method,s.total,s.source,s.created_at,u.name AS user_name
    FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.shift_id=$1 ORDER BY s.created_at,s.id`,[id])).rows;
  const saleIds=sales.map(x=>Number(x.id));
  const items=saleIds.length?(await pool.query(`SELECT sale_id,name_snapshot AS name,price,quantity FROM sale_items WHERE sale_id=ANY($1::bigint[]) ORDER BY id`,[saleIds])).rows:[];
  const bySale=new Map();
  for(const item of items){const key=Number(item.sale_id);if(!bySale.has(key))bySale.set(key,[]);bySale.get(key).push(item)}
  for(const sale of sales) sale.items=bySale.get(Number(sale.id))||[];
  const operations=(await pool.query(`SELECT c.id,c.type,c.amount,c.reason,c.created_at,u.name AS user_name
    FROM cash_operations c LEFT JOIN users u ON u.id=c.user_id WHERE c.shift_id=$1 ORDER BY c.created_at,c.id`,[id])).rows;
  res.json({shift,sales,operations});
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
    COALESCE(SUM(CASE WHEN method='online' THEN total ELSE 0 END),0)::bigint AS online_sales,
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
  const {rows}=await pool.query('SELECT id,customer_name,customer_phone,status,total,promo_code,discount_amount,payment_method,payment_status,paid_at,(payment_receipt_data IS NOT NULL) AS has_payment_receipt,payment_reviewed_at,payment_reviewed_by,delivery_type,delivery_address,delivery_lat,delivery_lng,delivery_comment,created_at FROM online_orders WHERE branch_id=$1 ORDER BY created_at DESC LIMIT 100',[branchId]);
  res.json(rows);
});

app.get('/api/orders/:id', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id);
  const {rows}=await pool.query(`SELECT id,branch_id,customer_id,customer_name,customer_phone,status,total,payment_method,payment_status,paid_at,
    (payment_receipt_data IS NOT NULL) AS has_payment_receipt,payment_reviewed_at,payment_reviewed_by,delivery_type,delivery_address,delivery_lat,delivery_lng,delivery_comment,created_at
    FROM online_orders WHERE id=$1 AND branch_id=$2`,[id,branchId]);
  if(!rows[0]) return res.status(404).json({error:'Заказ не найден'});
  const items=(await pool.query('SELECT product_id,name_snapshot AS name,price,quantity FROM online_order_items WHERE order_id=$1 ORDER BY id',[id])).rows;
  res.json({...rows[0],items});
});

app.get('/api/orders/:id/receipt', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id);
  const {rows}=await pool.query('SELECT payment_receipt_mime,payment_receipt_data FROM online_orders WHERE id=$1 AND branch_id=$2',[id,branchId]);
  const o=rows[0];
  if(!o || !o.payment_receipt_data) return res.status(404).json({error:'Чек не найден'});
  res.setHeader('Content-Type',o.payment_receipt_mime||'image/jpeg');
  res.setHeader('Cache-Control','private, no-store');
  res.send(o.payment_receipt_data);
});

app.put('/api/orders/:id/payment-review', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id), action=String(req.body.action||'');
  if(!['approve','reject'].includes(action)) return res.status(400).json({error:'Некорректное действие'});
  const order=(await pool.query('SELECT id,status,payment_method,payment_status,(payment_receipt_data IS NOT NULL) AS has_receipt FROM online_orders WHERE id=$1 AND branch_id=$2',[id,branchId])).rows[0];
  if(!order) return res.status(404).json({error:'Заказ не найден'});
  if(order.payment_method!=='receipt') return res.status(400).json({error:'У этого заказа нет оплаты по чеку'});
  if(!order.has_receipt) return res.status(400).json({error:'Чек не загружен'});
  if(order.status==='completed') return res.status(400).json({error:'Заказ уже завершён'});
  if(action==='approve'){
    await pool.query("UPDATE online_orders SET payment_status='paid',paid_at=NOW(),payment_reviewed_at=NOW(),payment_reviewed_by=$1 WHERE id=$2 AND branch_id=$3",[req.user.id,id,branchId]);
    return res.json({ok:true,paymentStatus:'paid'});
  }
  await pool.query("UPDATE online_orders SET payment_status='rejected',paid_at=NULL,payment_reviewed_at=NOW(),payment_reviewed_by=$1 WHERE id=$2 AND branch_id=$3",[req.user.id,id,branchId]);
  res.json({ok:true,paymentStatus:'rejected'});
});

app.put('/api/orders/:id/status', auth, async (req,res)=>{
  const branchId=await resolveBranch(req), id=Number(req.params.id), status=String(req.body.status||'');
  if(!['new','accepted','ready','completed','cancelled'].includes(status)) return res.status(400).json({error:'Некорректный статус'});
  const order=(await pool.query('SELECT * FROM online_orders WHERE id=$1 AND branch_id=$2',[id,branchId])).rows[0];
  if(!order) return res.status(404).json({error:'Заказ не найден'});
  if(status==='completed'){
    if(order.status==='completed') return res.json({ok:true,alreadyCompleted:true});
    if(order.status==='cancelled') return res.status(400).json({error:'Отменённый заказ нельзя завершить'});
    let method=String(req.body.paymentMethod||'');
    if(order.payment_method==='payme'){
      if(order.payment_status!=='paid') return res.status(400).json({error:'Онлайн-оплата ещё не подтверждена'});
      method='online';
    }else if(order.payment_method==='receipt'){
      if(order.payment_status!=='paid') return res.status(400).json({error:'Сначала подтвердите оплату по чеку'});
      method='card';
    }else if(!['cash','card'].includes(method)) return res.status(400).json({error:'Выберите способ оплаты'});
    const orderItems=(await pool.query('SELECT product_id AS "productId",name_snapshot AS name,price,quantity FROM online_order_items WHERE order_id=$1',[id])).rows;
    try{
      const sale=await createSale({branchId,userId:req.user.id,method,items:[],fixedItems:orderItems,source:`online_order:${id}`});
      await pool.query("UPDATE online_orders SET status='completed',payment_status='paid',paid_at=COALESCE(paid_at,NOW()),payment_method=CASE WHEN payment_method IN ('payme','receipt') THEN payment_method ELSE $3 END WHERE id=$1 AND branch_id=$2",[id,branchId,method]);
      return res.json({ok:true,sale});
    }catch(e){return res.status(e.status||500).json({error:e.message||'Не удалось завершить заказ'});}
  }
  if(order.status==='completed') return res.status(400).json({error:'Завершённый заказ нельзя изменить'});
  if(order.payment_method==='receipt' && ['accepted','ready'].includes(status) && order.payment_status!=='paid') return res.status(400).json({error:'Сначала подтвердите оплату по чеку'});
  await pool.query('UPDATE online_orders SET status=$1 WHERE id=$2 AND branch_id=$3',[status,id,branchId]);
  res.json({ok:true});
});

app.get('/api/customer-qr', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const url=`${originFor(req)}/menu.html?branch=${branchId}`;
  const dataUrl=await QRCode.toDataURL(url,{width:900,margin:4,errorCorrectionLevel:'H'});
  res.json({url,dataUrl,pngUrl:'/api/customer-qr/download?format=png',svgUrl:'/api/customer-qr/download?format=svg'});
});

app.get('/api/customer-qr/download', auth, allow('owner','admin'), async (req,res)=>{
  const branchId=await resolveBranch(req);
  const url=`${originFor(req)}/menu.html?branch=${branchId}`;
  const format=String(req.query.format||'png').toLowerCase();
  if(format==='svg'){
    const svg=await QRCode.toString(url,{type:'svg',margin:4,errorCorrectionLevel:'H'});
    res.setHeader('Content-Type','image/svg+xml; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="in-coffee-qr-${branchId}.svg"`);
    return res.send(svg);
  }
  const png=await QRCode.toBuffer(url,{type:'png',width:1800,margin:4,errorCorrectionLevel:'H'});
  res.setHeader('Content-Type','image/png');
  res.setHeader('Content-Disposition',`attachment; filename="in-coffee-qr-${branchId}-1800.png"`);
  res.send(png);
});


app.post('/api/telegram/webhook', async (req,res)=>{
  if(!telegramConfigured()) return res.sendStatus(204);
  const secret=String(req.get('X-Telegram-Bot-Api-Secret-Token')||'');
  if(secret!==TELEGRAM_WEBHOOK_SECRET) return res.sendStatus(403);
  const message=req.body?.message;
  if(!message) return res.json({ok:true});
  const chatId=message.chat?.id, fromId=message.from?.id;
  if(!chatId||!fromId) return res.json({ok:true});

  try{
    const text=String(message.text||'').trim();
    const startMatch=text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{20,64})$/);
    if(startMatch){
      const token=startMatch[1];
      const {rows}=await pool.query('SELECT * FROM customer_telegram_verifications WHERE token=$1',[token]);
      const record=rows[0];
      if(!record||new Date(record.expires_at).getTime()<Date.now()){
        await sendTelegramMessage(chatId,'Ссылка In coffee истекла. Вернитесь на сайт и начните подтверждение заново.',{remove_keyboard:true});
        return res.json({ok:true});
      }
      await pool.query('UPDATE customer_telegram_verifications SET telegram_user_id=$1,telegram_chat_id=$2,updated_at=NOW() WHERE token=$3',[fromId,chatId,token]);
      await sendTelegramMessage(chatId,`In coffee хочет подтвердить номер ${record.phone}. Нажмите кнопку ниже и отправьте именно свой номер Telegram.`,{
        keyboard:[[{text:'📱 Поделиться моим номером',request_contact:true}]],
        resize_keyboard:true,
        one_time_keyboard:true,
        input_field_placeholder:'Нажмите кнопку подтверждения'
      });
      return res.json({ok:true});
    }

    if(message.contact){
      const {rows}=await pool.query(`SELECT * FROM customer_telegram_verifications
        WHERE telegram_user_id=$1 AND telegram_chat_id=$2 AND verified=false AND expires_at>NOW()
        ORDER BY created_at DESC LIMIT 1`,[fromId,chatId]);
      const record=rows[0];
      if(!record){
        await sendTelegramMessage(chatId,'Сначала откройте кнопку «Подтвердить через Telegram» на сайте In coffee.',{remove_keyboard:true});
        return res.json({ok:true});
      }
      if(!message.contact.user_id||Number(message.contact.user_id)!==Number(fromId)){
        await sendTelegramMessage(chatId,'Можно подтвердить только свой номер Telegram. Нажмите «Поделиться моим номером».');
        return res.json({ok:true});
      }
      const phone=normalizeCustomerPhone(message.contact.phone_number);
      if(!phone||phone!==record.phone){
        await sendTelegramMessage(chatId,`Этот Telegram привязан к номеру ${phone||'неизвестно'}, а на сайте указан ${record.phone}. Вернитесь на сайт и укажите свой номер.`,{remove_keyboard:true});
        return res.json({ok:true});
      }
      await pool.query('UPDATE customer_telegram_verifications SET verified=true,updated_at=NOW() WHERE token=$1',[record.token]);
      await sendTelegramMessage(chatId,'✅ Номер подтверждён для In coffee. Вернитесь на сайт — регистрация или подтверждение завершится автоматически.',{remove_keyboard:true});
      return res.json({ok:true});
    }
  }catch(e){
    console.error('Telegram webhook error:',e.message);
  }
  res.json({ok:true});
});

app.post('/api/customer/register/start', verificationLimiter, async (req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,80);
  const phone=normalizeCustomerPhone(req.body.phone);
  const password=String(req.body.password||'');
  if(!name) return res.status(400).json({error:'Введите имя'});
  if(!phone) return res.status(400).json({error:'Введите номер Узбекистана в формате +998 XX XXX XX XX'});
  if(password.length<8) return res.status(400).json({error:'Пароль должен быть не короче 8 символов'});
  const exists=(await pool.query('SELECT id FROM customer_accounts WHERE phone=$1',[phone])).rows[0];
  if(exists) return res.status(400).json({error:'Аккаунт с таким номером уже существует. Выполните вход.'});
  try{
    const result=await createTelegramVerification({phone,purpose:'register',payload:{name,passwordHash:hashPassword(password)}});
    res.json({...result,phoneMasked:phone.replace(/(\+998\d{2})\d{5}(\d{2})/,'$1*****$2')});
  }catch(e){res.status(e.status||502).json({error:e.message||'Не удалось начать подтверждение через Telegram'})}
});

app.get('/api/customer/register/status', verificationLimiter, async (req,res)=>{
  const token=String(req.query.token||'');
  const record=await getTelegramVerification(token,'register');
  if(!record) return res.status(404).json({error:'Ссылка подтверждения не найдена'});
  if(new Date(record.expires_at).getTime()<Date.now()) return res.status(400).json({error:'Ссылка подтверждения истекла. Начните регистрацию заново.'});
  if(!record.verified) return res.json({ok:true,verified:false});
  if(record.customer_id){
    const customer=(await pool.query('SELECT id,name,phone,phone_verified,created_at FROM customer_accounts WHERE id=$1',[record.customer_id])).rows[0];
    if(customer){ const customerView=await enrichCustomer(customer); setCustomerCookie(res,signCustomer(customer)); return res.json({ok:true,verified:true,customer:customerView}); }
  }
  const payload=record.payload||{};
  const name=String(payload.name||'').trim().slice(0,80), passwordHash=String(payload.passwordHash||'');
  if(!name||!passwordHash) return res.status(400).json({error:'Данные регистрации истекли. Начните регистрацию заново.'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const locked=(await client.query("SELECT * FROM customer_telegram_verifications WHERE token=$1 AND purpose='register' FOR UPDATE",[token])).rows[0];
    if(!locked||!locked.verified) { await client.query('ROLLBACK'); return res.json({ok:true,verified:false}); }
    if(locked.customer_id){
      const customer=(await client.query('SELECT id,name,phone,phone_verified,created_at FROM customer_accounts WHERE id=$1',[locked.customer_id])).rows[0];
      await client.query('COMMIT');
      if(customer){ const customerView=await enrichCustomer(customer); setCustomerCookie(res,signCustomer(customer)); return res.json({ok:true,verified:true,customer:customerView}); }
    }
    const {rows}=await client.query('INSERT INTO customer_accounts(name,phone,password_hash,phone_verified) VALUES($1,$2,$3,true) RETURNING id,name,phone,phone_verified,created_at',[name,record.phone,passwordHash]);
    const customer=rows[0];
    await client.query('UPDATE customer_telegram_verifications SET customer_id=$1,updated_at=NOW() WHERE token=$2',[customer.id,token]);
    await client.query('COMMIT');
    const customerView=await enrichCustomer(customer, client);
    setCustomerCookie(res,signCustomer(customer));
    res.json({ok:true,verified:true,customer:customerView});
  }catch(e){
    await client.query('ROLLBACK');
    if(e.code==='23505') return res.status(400).json({error:'Аккаунт с таким номером уже существует'});
    throw e;
  }finally{client.release()}
});

app.post('/api/customer/login', loginLimiter, async (req,res)=>{
  const phone=normalizeCustomerPhone(req.body.phone);
  const password=String(req.body.password||'');
  if(!phone) return res.status(400).json({error:'Введите номер телефона'});
  const {rows}=await pool.query('SELECT id,name,phone,password_hash,phone_verified,active,created_at FROM customer_accounts WHERE phone=$1',[phone]);
  const customer=rows[0];
  if(!customer||!customer.active||!verifyPassword(password,customer.password_hash)) return res.status(401).json({error:'Неверный номер телефона или пароль'});
  const customerView=await enrichCustomer({id:customer.id,name:customer.name,phone:customer.phone,phone_verified:customer.phone_verified,created_at:customer.created_at});
  setCustomerCookie(res,signCustomer(customer));
  res.json({ok:true,customer:customerView});
});

app.post('/api/customer/verification/send', customerAuth, verificationLimiter, async (req,res)=>{
  if(req.customer.phone_verified) return res.json({ok:true,alreadyVerified:true});
  try{
    const result=await createTelegramVerification({phone:req.customer.phone,purpose:'verify_existing',payload:{customerId:req.customer.id},customerId:req.customer.id});
    res.json({...result,phoneMasked:req.customer.phone.replace(/(\+998\d{2})\d{5}(\d{2})/,'$1*****$2')});
  }catch(e){res.status(e.status||502).json({error:e.message||'Не удалось начать подтверждение через Telegram'})}
});

app.get('/api/customer/verification/status', customerAuth, verificationLimiter, async (req,res)=>{
  if(req.customer.phone_verified) return res.json({ok:true,verified:true,customer:await enrichCustomer(req.customer)});
  const token=String(req.query.token||'');
  const record=await getTelegramVerification(token,'verify_existing');
  if(!record||Number(record.customer_id)!==Number(req.customer.id)) return res.status(404).json({error:'Ссылка подтверждения не найдена'});
  if(new Date(record.expires_at).getTime()<Date.now()) return res.status(400).json({error:'Ссылка подтверждения истекла. Начните заново.'});
  if(!record.verified) return res.json({ok:true,verified:false});
  const {rows}=await pool.query('UPDATE customer_accounts SET phone_verified=true,updated_at=NOW() WHERE id=$1 RETURNING id,name,phone,phone_verified,active,created_at',[req.customer.id]);
  await pool.query('DELETE FROM customer_telegram_verifications WHERE token=$1',[token]);
  res.json({ok:true,verified:true,customer:await enrichCustomer(rows[0])});
});

app.post('/api/customer/logout',(req,res)=>{clearCustomerCookie(res);res.json({ok:true})});

app.get('/api/customer/me',customerAuth,async(req,res)=>{
  res.json({customer:await enrichCustomer(req.customer)});
});

app.put('/api/customer/me',customerAuth,async(req,res)=>{
  const name=String(req.body.name||'').trim().slice(0,80);
  if(!name) return res.status(400).json({error:'Введите имя'});
  const {rows}=await pool.query('UPDATE customer_accounts SET name=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,phone,phone_verified,created_at',[name,req.customer.id]);
  res.json({ok:true,customer:await enrichCustomer(rows[0])});
});

app.post('/api/customer/password',customerAuth,async(req,res)=>{
  const current=String(req.body.currentPassword||''), next=String(req.body.newPassword||'');
  if(next.length<8) return res.status(400).json({error:'Новый пароль должен быть не короче 8 символов'});
  const {rows}=await pool.query('SELECT password_hash FROM customer_accounts WHERE id=$1',[req.customer.id]);
  if(!verifyPassword(current,rows[0]?.password_hash)) return res.status(400).json({error:'Текущий пароль неверный'});
  await pool.query('UPDATE customer_accounts SET password_hash=$1,updated_at=NOW() WHERE id=$2',[hashPassword(next),req.customer.id]);
  res.json({ok:true});
});

app.get('/api/customer/orders',customerAuth,async(req,res)=>{
  const {rows:orders}=await pool.query(`SELECT o.id,o.branch_id,b.name AS branch_name,o.status,o.total,o.promo_code,o.discount_amount,o.payment_method,o.payment_status,o.paid_at,(o.payment_receipt_data IS NOT NULL) AS has_payment_receipt,o.delivery_type,o.delivery_address,o.delivery_comment,o.created_at
    FROM online_orders o LEFT JOIN branches b ON b.id=o.branch_id WHERE o.customer_id=$1 ORDER BY o.created_at DESC LIMIT 100`,[req.customer.id]);
  if(!orders.length) return res.json([]);
  const ids=orders.map(o=>Number(o.id));
  const {rows:items}=await pool.query('SELECT order_id,name_snapshot,price,quantity FROM online_order_items WHERE order_id=ANY($1::bigint[]) ORDER BY id',[ids]);
  const grouped=new Map();
  for(const item of items){const key=Number(item.order_id);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(item)}
  res.json(orders.map(o=>({...o,items:grouped.get(Number(o.id))||[]})));
});

app.get('/api/customers',auth,allow('owner','admin'),async(req,res)=>{
  const {rows}=await pool.query(`SELECT c.id,c.name,c.phone,c.phone_verified,c.active,c.created_at,COUNT(o.id)::int AS orders_count,COALESCE(SUM(CASE WHEN o.payment_status='paid' THEN o.total ELSE 0 END),0)::bigint AS paid_total
    FROM customer_accounts c LEFT JOIN online_orders o ON o.customer_id=c.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 500`);
  res.json(rows);
});

app.get('/api/customer-stats',auth,allow('owner','admin'),async(req,res)=>{
  const {rows}=await pool.query(`SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE phone_verified=true)::int AS verified,
    COUNT(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Tashkent')::date=(NOW() AT TIME ZONE 'Asia/Tashkent')::date)::int AS today,
    COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM online_orders o WHERE o.customer_id=customer_accounts.id))::int AS with_orders
    FROM customer_accounts`);
  res.json(rows[0]||{total:0,verified:0,today:0,with_orders:0});
});

app.get('/api/maps-settings',auth,allow('owner','admin'),async(req,res)=>{
  const settings=await effectiveYandexMapsSettings();
  res.json({provider:'Yandex Maps JavaScript API',...settings});
});

app.put('/api/maps-settings',auth,allow('owner','admin'),async(req,res)=>{
  const apiKey=String(req.body.apiKey||'').trim().slice(0,220);
  if(apiKey.length<10) return res.status(400).json({error:'Введите API-ключ Яндекс Карт'});
  await setAppSetting('yandex_maps_api_key',apiKey);
  res.json({ok:true,provider:'Yandex Maps JavaScript API',configured:true,apiKey});
});

app.get('/api/payment-settings', auth, async (req,res)=>{
  const settings=await effectiveCardTransferSettings();
  res.json({provider:'Card transfer + receipt',...settings});
});

app.put('/api/payment-settings', auth, allow('owner','admin'), async (req,res)=>{
  const cardNumber=String(req.body.cardNumber||'').replace(/[^0-9 ]/g,'').trim().slice(0,32);
  const cardHolder=String(req.body.cardHolder||'').trim().slice(0,120);
  if(cardNumber.replace(/\s/g,'').length<12) return res.status(400).json({error:'Введите корректный номер карты'});
  await Promise.all([setAppSetting('card_transfer_number',cardNumber),setAppSetting('card_transfer_holder',cardHolder)]);
  res.json({ok:true,provider:'Card transfer + receipt',configured:true,cardNumber,cardHolder});
});

app.get('/api/public/verification-config', async (req,res)=>{
  res.json({provider:'Telegram',enabled:telegramConfigured(),botUsername:TELEGRAM_BOT_USERNAME,ttlMinutes:TELEGRAM_VERIFY_TTL_MINUTES});
});

app.get('/api/public/business-status', async (req,res)=>{ res.json(publicBusinessStatus()); });

app.get('/api/public/payment-config', async (req,res)=>{
  const settings=await effectiveCardTransferSettings();
  res.json({provider:'receipt',enabled:settings.configured,cardNumber:settings.cardNumber,cardHolder:settings.cardHolder,promoCode:FIRST_ORDER_PROMO_CODE,promoPercent:FIRST_ORDER_PROMO_PERCENT});
});

app.get('/api/public/branches' , async (req,res)=>{
  const {rows}=await pool.query('SELECT id,name,address FROM branches WHERE active=true ORDER BY id');
  res.json(rows);
});

app.get('/api/public/maps-config', async (req,res)=>{
  const settings=await effectiveYandexMapsSettings();
  res.json({provider:'Yandex Maps',enabled:settings.configured,apiKey:settings.apiKey});
});

app.get('/api/public/products', async (req,res)=>{
  const branchId=Number(req.query.branch||0);
  if(branchId){
    const ok=(await pool.query('SELECT id FROM branches WHERE id=$1 AND active=true',[branchId])).rows[0];
    if(!ok) return res.status(404).json({error:'Филиал не найден'});
  }
  res.json((await pool.query(`SELECT ${productSelect()} FROM products WHERE active=true ORDER BY category,name`)).rows);
});

app.post('/api/public/orders', customerAuth, orderLimiter, imageUpload.single('receipt'), async (req,res)=>{
  if(!onlineOrderingOpen()) return res.status(403).json({error:'Онлайн-заказы принимаются с 08:00 до 01:00 по времени Узбекистана'});
  if(!req.customer.phone_verified) return res.status(403).json({error:'Подтвердите номер телефона через Telegram перед заказом'});
  let parsedItems=req.body.items;
  if(typeof parsedItems==='string'){try{parsedItems=JSON.parse(parsedItems)}catch{parsedItems=[]}}
  const branchId=Number(req.body.branchId), customerName=req.customer.name, customerPhone=req.customer.phone, items=Array.isArray(parsedItems)?parsedItems:[];
  const deliveryType='delivery';
  const deliveryAddress=String(req.body.deliveryAddress||'').trim().slice(0,220);
  const deliveryComment=String(req.body.deliveryComment||'').trim().slice(0,300);
  const hasLat=req.body.deliveryLat!==null&&req.body.deliveryLat!==undefined&&req.body.deliveryLat!=='';
  const hasLng=req.body.deliveryLng!==null&&req.body.deliveryLng!==undefined&&req.body.deliveryLng!=='';
  const rawLat=hasLat?Number(req.body.deliveryLat):NaN, rawLng=hasLng?Number(req.body.deliveryLng):NaN;
  const deliveryLat=Number.isFinite(rawLat)&&rawLat>=-90&&rawLat<=90?rawLat:null;
  const deliveryLng=Number.isFinite(rawLng)&&rawLng>=-180&&rawLng<=180?rawLng:null;
  const paymentMethod=String(req.body.paymentMethod||'receipt');
  const promoCode=String(req.body.promoCode||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,32);
  if(paymentMethod!=='receipt') return res.status(400).json({error:'Для онлайн-заказа доступна только оплата переводом на карту'});
  if(!deliveryAddress) return res.status(400).json({error:'Укажите адрес доставки'});
  const transferSettings=await effectiveCardTransferSettings();
  if(!transferSettings.configured) return res.status(400).json({error:'Оплата переводом пока не настроена. Сохраните карту в админке: QR и меню → Онлайн-оплата'});
  if(!req.file) return res.status(400).json({error:'Загрузите чек оплаты'});
  if(!branchId || !items.length) return res.status(400).json({error:'Выберите филиал и товары'});
  const branch=(await pool.query('SELECT id FROM branches WHERE id=$1 AND active=true',[branchId])).rows[0];
  if(!branch) return res.status(400).json({error:'Филиал недоступен'});
  const ids=items.map(x=>Number(x.productId)).filter(Boolean);
  const {rows:products}=await pool.query('SELECT id,name,price FROM products WHERE active=true AND id=ANY($1::int[])',[ids]);
  const map=new Map(products.map(p=>[Number(p.id),p]));
  const normalized=[]; let subtotal=0;
  for(const raw of items){
    const p=map.get(Number(raw.productId)); const quantity=Math.min(20,Math.max(1,Math.floor(Number(raw.quantity)||1)));
    if(!p) return res.status(400).json({error:'Один из товаров недоступен'});
    subtotal += Number(p.price)*quantity; normalized.push({p,quantity});
  }
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    let discountAmount = 0;
    let approvedPromoCode = '';
    if(promoCode){
      if(promoCode !== FIRST_ORDER_PROMO_CODE) { await client.query('ROLLBACK'); return res.status(400).json({error:`Неверный промокод. Используйте ${FIRST_ORDER_PROMO_CODE}`}); }
      const eligible = await customerFirstOrderEligible(req.customer.id, client);
      if(!eligible) { await client.query('ROLLBACK'); return res.status(400).json({error:`Промокод ${FIRST_ORDER_PROMO_CODE} действует только на первый заказ`}); }
      discountAmount = Math.max(0, Math.round(subtotal * FIRST_ORDER_PROMO_PERCENT / 100));
      approvedPromoCode = FIRST_ORDER_PROMO_CODE;
    }
    const total = Math.max(0, subtotal - discountAmount);
    const paymentStatus=paymentMethod==='receipt'?'review':'unpaid';
    const order=(await client.query('INSERT INTO online_orders(branch_id,customer_id,customer_name,customer_phone,total,promo_code,discount_amount,payment_method,payment_status,payment_receipt_mime,payment_receipt_data,delivery_type,delivery_address,delivery_lat,delivery_lng,delivery_comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id,total,promo_code,discount_amount,status,payment_method,payment_status,delivery_type,delivery_address,delivery_lat,delivery_lng,delivery_comment,created_at',[branchId,req.customer.id,customerName,customerPhone,total,approvedPromoCode,discountAmount,paymentMethod,paymentStatus,paymentMethod==='receipt'?req.file.mimetype:null,paymentMethod==='receipt'?req.file.buffer:null,deliveryType,deliveryType==='delivery'?deliveryAddress:'',deliveryType==='delivery'?deliveryLat:null,deliveryType==='delivery'?deliveryLng:null,deliveryType==='delivery'?deliveryComment:''])).rows[0];
    order.subtotal = subtotal;
    for(const item of normalized) await client.query('INSERT INTO online_order_items(order_id,product_id,name_snapshot,price,quantity) VALUES($1,$2,$3,$4,$5)',[order.id,item.p.id,item.p.name,item.p.price,item.quantity]);
    await client.query('COMMIT');
    res.json({ok:true,order});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
});

app.get('/api/public/order-payment/:id', customerAuth, orderLimiter, async (req,res)=>{
  const id=Number(req.params.id);
  const {rows}=await pool.query('SELECT id,payment_method,payment_status,status,total FROM online_orders WHERE id=$1 AND customer_id=$2',[id,req.customer.id]);
  const o=rows[0];
  if(!o) return res.status(404).json({error:'Заказ не найден'});
  res.json(o);
});

app.post('/api/payme', async (req,res)=>{
  const rpcId=req.body?.id ?? null;
  if(!paymeConfigured()) return res.json(paymeRpcError(rpcId,-32504,'Payme не настроен'));
  const authData=parseBasicAuth(req), expectedSecret=paymeSecret();
  if(!authData || authData.login!==PAYME_LOGIN || authData.password!==expectedSecret){
    return res.json(paymeRpcError(rpcId,-32504,'Недостаточно привилегий'));
  }
  const method=String(req.body?.method||'');
  const params=req.body?.params||{};
  const account=params.account||{};
  const orderId=Number(account[PAYME_ACCOUNT_FIELD]||0);
  const now=Date.now();
  const orderError=(code,ru,data)=>res.json(paymeRpcError(rpcId,code,ru,data));
  const getOrder=async id=>(await pool.query('SELECT * FROM online_orders WHERE id=$1',[id])).rows[0];
  const validateOrder=async()=>{
    const order=await getOrder(orderId);
    if(!order || order.payment_method!=='payme') return {error:[-31050,'Заказ не найден',PAYME_ACCOUNT_FIELD]};
    if(Math.round(Number(params.amount||0))!==Math.round(Number(order.total)*100)) return {error:[-31001,'Неверная сумма']};
    if(order.status==='cancelled') return {error:[-31008,'Заказ отменён']};
    return {order};
  };
  try{
    if(method==='CheckPerformTransaction'){
      const v=await validateOrder(); if(v.error)return orderError(...v.error);
      if(v.order.payment_status==='paid')return orderError(-31008,'Заказ уже оплачен');
      return res.json(paymeRpcResult(rpcId,{allow:true}));
    }
    if(method==='CreateTransaction'){
      const paymeId=String(params.id||'');
      if(!paymeId || !Number.isFinite(Number(params.time))) return orderError(-32600,'Некорректный запрос');
      const existing=(await pool.query('SELECT * FROM payme_transactions WHERE payme_id=$1',[paymeId])).rows[0];
      if(existing){
        if(existing.state===1 && now-Number(existing.time_ms)>43200000){
          await pool.query('UPDATE payme_transactions SET state=-1,reason=4,cancel_time_ms=$1 WHERE payme_id=$2',[now,paymeId]);
          await pool.query("UPDATE online_orders SET payment_status='cancelled' WHERE id=$1 AND payment_status<>'paid'",[existing.order_id]);
          return orderError(-31008,'Транзакция отменена по таймауту');
        }
        return res.json(paymeRpcResult(rpcId,{create_time:Number(existing.create_time_ms),transaction:String(existing.order_id),state:Number(existing.state)}));
      }
      const v=await validateOrder(); if(v.error)return orderError(...v.error);
      const other=(await pool.query('SELECT payme_id,state FROM payme_transactions WHERE order_id=$1 AND state IN (1,2) LIMIT 1',[orderId])).rows[0];
      if(other) return orderError(-31008,'Для заказа уже существует транзакция');
      const createTime=now;
      await pool.query('INSERT INTO payme_transactions(payme_id,order_id,time_ms,amount_tiyin,create_time_ms,state) VALUES($1,$2,$3,$4,$5,1)',[paymeId,orderId,Number(params.time),Number(params.amount),createTime]);
      await pool.query("UPDATE online_orders SET payment_status='pending' WHERE id=$1",[orderId]);
      return res.json(paymeRpcResult(rpcId,{create_time:createTime,transaction:String(orderId),state:1}));
    }
    if(method==='PerformTransaction'){
      const paymeId=String(params.id||'');
      const tx=(await pool.query('SELECT * FROM payme_transactions WHERE payme_id=$1',[paymeId])).rows[0];
      if(!tx)return orderError(-31003,'Транзакция не найдена');
      if(tx.state===2)return res.json(paymeRpcResult(rpcId,{transaction:String(tx.order_id),perform_time:Number(tx.perform_time_ms),state:2}));
      if(tx.state!==1)return orderError(-31008,'Невозможно выполнить операцию');
      if(now-Number(tx.time_ms)>43200000){
        await pool.query('UPDATE payme_transactions SET state=-1,reason=4,cancel_time_ms=$1 WHERE payme_id=$2',[now,paymeId]);
        await pool.query("UPDATE online_orders SET payment_status='cancelled' WHERE id=$1",[tx.order_id]);
        return orderError(-31008,'Транзакция отменена по таймауту');
      }
      await pool.query('UPDATE payme_transactions SET state=2,perform_time_ms=$1 WHERE payme_id=$2',[now,paymeId]);
      await pool.query("UPDATE online_orders SET payment_status='paid',paid_at=NOW() WHERE id=$1",[tx.order_id]);
      return res.json(paymeRpcResult(rpcId,{transaction:String(tx.order_id),perform_time:now,state:2}));
    }
    if(method==='CancelTransaction'){
      const paymeId=String(params.id||'');
      const tx=(await pool.query('SELECT * FROM payme_transactions WHERE payme_id=$1',[paymeId])).rows[0];
      if(!tx)return orderError(-31003,'Транзакция не найдена');
      const order=await getOrder(tx.order_id);
      if(order?.status==='completed')return orderError(-31007,'Заказ уже выдан');
      if(tx.state<0)return res.json(paymeRpcResult(rpcId,{transaction:String(tx.order_id),cancel_time:Number(tx.cancel_time_ms),state:Number(tx.state)}));
      const state=tx.state===2?-2:-1, reason=Number(params.reason||10);
      await pool.query('UPDATE payme_transactions SET state=$1,reason=$2,cancel_time_ms=$3 WHERE payme_id=$4',[state,reason,now,paymeId]);
      await pool.query("UPDATE online_orders SET payment_status='cancelled',paid_at=NULL WHERE id=$1",[tx.order_id]);
      return res.json(paymeRpcResult(rpcId,{transaction:String(tx.order_id),cancel_time:now,state}));
    }
    if(method==='CheckTransaction'){
      const tx=(await pool.query('SELECT * FROM payme_transactions WHERE payme_id=$1',[String(params.id||'')])).rows[0];
      if(!tx)return orderError(-31003,'Транзакция не найдена');
      return res.json(paymeRpcResult(rpcId,{create_time:Number(tx.create_time_ms),perform_time:Number(tx.perform_time_ms),cancel_time:Number(tx.cancel_time_ms),transaction:String(tx.order_id),state:Number(tx.state),reason:tx.reason===null?null:Number(tx.reason)}));
    }
    if(method==='GetStatement'){
      const from=Number(params.from||0),to=Number(params.to||0);
      const {rows}=await pool.query('SELECT * FROM payme_transactions WHERE time_ms BETWEEN $1 AND $2 ORDER BY time_ms',[from,to]);
      return res.json(paymeRpcResult(rpcId,{transactions:rows.map(tx=>({id:tx.payme_id,time:Number(tx.time_ms),amount:Number(tx.amount_tiyin),account:{[PAYME_ACCOUNT_FIELD]:String(tx.order_id)},create_time:Number(tx.create_time_ms),perform_time:Number(tx.perform_time_ms),cancel_time:Number(tx.cancel_time_ms),transaction:String(tx.order_id),state:Number(tx.state),reason:tx.reason===null?null:Number(tx.reason)}))}));
    }
    if(method==='SetFiscalData'){
      const paymeId=String(params.id||'');
      const tx=(await pool.query('SELECT payme_id FROM payme_transactions WHERE payme_id=$1',[paymeId])).rows[0];
      if(!tx)return res.json({error:{code:-32001,message:'Чек с таким id не найден'},id:rpcId});
      if(String(params.type||'')==='CANCEL') await pool.query('UPDATE payme_transactions SET fiscal_cancel=$1 WHERE payme_id=$2',[params.fiscal_data||{},paymeId]);
      else await pool.query('UPDATE payme_transactions SET fiscal_perform=$1 WHERE payme_id=$2',[params.fiscal_data||{},paymeId]);
      return res.json(paymeRpcResult(rpcId,{success:true}));
    }
    return res.json(paymeRpcError(rpcId,-32601,'Метод не найден',method));
  }catch(e){
    console.error('Payme error',e);
    return res.json(paymeRpcError(rpcId,-32400,'Системная ошибка'));
  }
});

app.get('/api/export' , auth, allow('owner','admin'), async (req,res)=>{
  const branchId=req.user.role==='owner' ? null : await resolveBranch(req);
  const data={exportedAt:new Date().toISOString(),version:'13.0.0',brand:'In coffee'};
  if(branchId){
    data.branches=(await pool.query('SELECT id,name,address,active,created_at FROM branches WHERE id=$1',[branchId])).rows;
    data.users=(await pool.query('SELECT id,username,name,role,branch_id,active,created_at FROM users WHERE branch_id=$1',[branchId])).rows;
    data.products=(await pool.query("SELECT id,name,category,price,active,image_mime,(image_data IS NOT NULL) AS has_image,created_at FROM products ORDER BY id")).rows;
    data.inventory=(await pool.query('SELECT * FROM inventory_items WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.recipes=(await pool.query('SELECT * FROM recipes WHERE branch_id=$1 ORDER BY product_id,inventory_item_id',[branchId])).rows;
    data.sales=(await pool.query('SELECT * FROM sales WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.saleItems=(await pool.query('SELECT si.* FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE s.branch_id=$1 ORDER BY si.id',[branchId])).rows;
    data.cashOperations=(await pool.query('SELECT * FROM cash_operations WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.onlineOrders=(await pool.query('SELECT id,branch_id,customer_id,customer_name,customer_phone,status,total,promo_code,discount_amount,payment_method,payment_status,paid_at,(payment_receipt_data IS NOT NULL) AS has_payment_receipt,payment_reviewed_at,payment_reviewed_by,delivery_type,delivery_address,delivery_lat,delivery_lng,delivery_comment,created_at FROM online_orders WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.onlineOrderItems=(await pool.query('SELECT oi.* FROM online_order_items oi JOIN online_orders o ON o.id=oi.order_id WHERE o.branch_id=$1 ORDER BY oi.id',[branchId])).rows;
    data.inventoryMovements=(await pool.query('SELECT * FROM inventory_movements WHERE branch_id=$1 ORDER BY id',[branchId])).rows;
    data.customerAccounts=(await pool.query('SELECT id,name,phone,active,created_at,updated_at FROM customer_accounts ORDER BY id')).rows;
  }else{
    data.branches=(await pool.query('SELECT * FROM branches ORDER BY id')).rows;
    data.users=(await pool.query('SELECT id,username,name,role,branch_id,active,created_at FROM users ORDER BY id')).rows;
    data.products=(await pool.query("SELECT id,name,category,price,active,image_mime,(image_data IS NOT NULL) AS has_image,created_at FROM products ORDER BY id")).rows;
    data.inventory=(await pool.query('SELECT * FROM inventory_items ORDER BY id')).rows;
    data.recipes=(await pool.query('SELECT * FROM recipes ORDER BY branch_id,product_id,inventory_item_id')).rows;
    data.sales=(await pool.query('SELECT * FROM sales ORDER BY id')).rows;
    data.saleItems=(await pool.query('SELECT * FROM sale_items ORDER BY id')).rows;
    data.cashOperations=(await pool.query('SELECT * FROM cash_operations ORDER BY id')).rows;
    data.onlineOrders=(await pool.query('SELECT id,branch_id,customer_id,customer_name,customer_phone,status,total,promo_code,discount_amount,payment_method,payment_status,paid_at,(payment_receipt_data IS NOT NULL) AS has_payment_receipt,payment_reviewed_at,payment_reviewed_by,delivery_type,delivery_address,delivery_lat,delivery_lng,delivery_comment,created_at FROM online_orders ORDER BY id')).rows;
    data.onlineOrderItems=(await pool.query('SELECT * FROM online_order_items ORDER BY id')).rows;
    data.inventoryMovements=(await pool.query('SELECT * FROM inventory_movements ORDER BY id')).rows;
    data.customerAccounts=(await pool.query('SELECT id,name,phone,active,created_at,updated_at FROM customer_accounts ORDER BY id')).rows;
  }
  const stamp=new Date().toISOString().slice(0,10);
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="in-coffee-export-${stamp}.json"`);
  res.send(JSON.stringify(data,null,2));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({error: err.code==='LIMIT_FILE_SIZE'?'Файл слишком большой (максимум 3 МБ)':'Ошибка загрузки файла'});
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

initDb().then(() => {
  app.listen(PORT, HOST, async () => {
    console.log(`In coffee v13: http://${HOST}:${PORT}`);
    await setupTelegramWebhook();
  });
}).catch(err => {
  console.error('Database init failed:', err);
  process.exit(1);
});
