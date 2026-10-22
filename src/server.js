import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authEnabled, config, LOCAL_HOSTNAMES } from './config.js';
import { authRouter, isPublicRequest, requireAuth } from './auth.js';
import * as db from './db.js';
import { DEFAULT_CATEGORIES } from './categorize.js';
import { runSync, startSyncLoop, stopSyncLoop, syncStatus } from './mail-sync.js';
import { parseBcaEmail } from './parser/index.js';
import { htmlToLines, textToLines } from './parser/text.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const EMAIL_STATUSES = new Set(['parsed', 'ignored', 'unparsed']);
const ALLOWED_HOSTNAMES = new Set([...LOCAL_HOSTNAMES, ...(config.publicHostname ? [config.publicHostname] : [])]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}

function monthParam(value) {
  if (value === undefined || value === '') return currentMonth();
  if (typeof value !== 'string' || !MONTH_RE.test(value)) throw new HttpError(400, 'month must look like YYYY-MM');
  return value;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 3660;

function dateParam(value, name) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) throw new HttpError(400, `${name} must look like YYYY-MM-DD`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new HttpError(400, `${name} is not a real date`);
  return value;
}

/** Either ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive) or ?month=YYYY-MM (default: this month). */
function periodParam(query) {
  if (query.from !== undefined || query.to !== undefined) {
    const from = dateParam(query.from, 'from');
    const to = dateParam(query.to, 'to');
    if (from > to) throw new HttpError(400, 'from must be on or before to');
    if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_RANGE_DAYS) throw new HttpError(400, 'range is too long (max 10 years)');
    return { from, to };
  }
  const month = monthParam(query.month);
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

function idParam(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, 'invalid id');
  return id;
}

function optionalString(value, name, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new HttpError(400, `${name} must be text up to ${max} characters`);
  return value.trim() || null;
}

function requiredString(value, name, max) {
  const s = optionalString(value, name, max);
  if (!s) throw new HttpError(400, `${name} is required`);
  return s;
}

const MAX_AMOUNT = 1e13;

// A budget amount in rupiah; null/0/'' means "no budget".
function budgetAmount(value, name) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) {
    throw new HttpError(400, `${name} must be an amount between 0 and ${MAX_AMOUNT}`);
  }
  return Math.round(value * 100) / 100;
}

const app = express();
app.disable('x-powered-by');
// A tunnel running on this PC (e.g. Tailscale) forwards the public host name and https in X-Forwarded-* headers.
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  });
  if (isPublicRequest(req)) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});

// When bound to this computer only, reject requests for any other host name (blocks DNS-rebinding attacks).
if (LOCAL_HOSTNAMES.has(config.host)) {
  app.use((req, res, next) => {
    if (!ALLOWED_HOSTNAMES.has(req.hostname)) return res.status(403).json({ error: 'Forbidden host' });
    next();
  });
}

// Changes must be sent as JSON: browsers cannot send that cross-site without a CORS preflight, which this app never allows.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
});
app.use(express.json({ limit: '10kb' }));

app.get('/api/health', async (req, res) => {
  await db.pool.query('SELECT 1');
  res.json({ ok: true });
});

app.use(authRouter);
app.use(requireAuth);
app.use(express.static(publicDir, { index: 'index.html' }));

app.get('/api/me', (req, res) => {
  res.json({ authEnabled, email: req.user?.email ?? null });
});

app.get('/api/months', async (req, res) => {
  const months = await db.listMonths();
  const now = currentMonth();
  res.json({ current: now, timezone: config.timezone, months: months.includes(now) ? months : [now, ...months] });
});

app.get('/api/summary', async (req, res) => {
  res.json(await db.getSummary(periodParam(req.query)));
});

app.get('/api/transactions', async (req, res) => {
  const rows = await db.listTransactions({
    ...periodParam(req.query),
    q: optionalString(req.query.q, 'q', 100),
    category: optionalString(req.query.category, 'category', 50),
  });
  res.json(rows);
});

app.patch('/api/transactions/:id', async (req, res) => {
  const { category, hidden, applyToMerchant } = req.body ?? {};
  const update = {
    category: optionalString(category, 'category', 50),
    hidden: typeof hidden === 'boolean' ? hidden : undefined,
    applyToMerchant: applyToMerchant === true,
  };
  if (update.category === null && update.hidden === undefined) throw new HttpError(400, 'nothing to update');
  const result = await db.updateTransaction(idParam(req.params.id), update);
  if (!result) throw new HttpError(404, 'transaction not found');
  res.json(result);
});

app.get('/api/categories', async (req, res) => {
  const used = await db.listCategories();
  res.json([...new Set([...DEFAULT_CATEGORIES, ...used])].sort((a, b) => a.localeCompare(b)));
});

app.post('/api/categories', async (req, res) => {
  const name = requiredString(req.body?.name, 'name', 50);
  await db.addCategory(name);
  res.status(201).json({ name });
});

app.get('/api/review', async (req, res) => {
  res.json(await db.listReviewQueue(periodParam(req.query)));
});

app.get('/api/rules', async (req, res) => {
  res.json(await db.listRules());
});

app.post('/api/rules', async (req, res) => {
  const pattern = requiredString(req.body?.pattern, 'pattern', 100);
  if (pattern.length < 2) throw new HttpError(400, 'pattern must be at least 2 characters');
  const category = requiredString(req.body?.category, 'category', 50);
  res.status(201).json(await db.addRule(pattern, category));
});

app.delete('/api/rules/:id', async (req, res) => {
  if (!(await db.deleteRule(idParam(req.params.id)))) throw new HttpError(404, 'rule not found');
  res.json({ ok: true });
});

app.get('/api/budgets', async (req, res) => {
  res.json(await db.getBudgets());
});

app.put('/api/budgets', async (req, res) => {
  const { total, categories = {} } = req.body ?? {};
  if (typeof categories !== 'object' || categories === null || Array.isArray(categories)) {
    throw new HttpError(400, 'categories must be an object of category: amount');
  }
  const entries = Object.entries(categories);
  if (entries.length > 200) throw new HttpError(400, 'too many categories');
  const clean = {};
  for (const [name, amount] of entries) {
    const category = requiredString(name, 'category', 50);
    const value = budgetAmount(amount, `budget for ${category}`);
    if (value) clean[category] = value;
  }
  res.json(await db.setBudgets({ total: budgetAmount(total, 'total'), categories: clean }));
});

app.get('/api/emails', async (req, res) => {
  const status = optionalString(req.query.status, 'status', 20);
  if (status && !EMAIL_STATUSES.has(status)) throw new HttpError(400, 'invalid status');
  const limit = req.query.limit === undefined ? 100 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new HttpError(400, 'limit must be 1-500');
  const [emails, counts, channels, uncategorized] = await Promise.all([
    db.listEmails(status, limit), db.emailCounts(), db.channelCounts(), db.uncategorizedCount(),
  ]);
  res.json({ counts: { ...counts, uncategorized }, channels, emails });
});

app.get('/api/emails/:id', async (req, res) => {
  const email = await db.getEmail(idParam(req.params.id));
  if (!email) throw new HttpError(404, 'email not found');
  // Send the text lines the parser saw, never the raw HTML.
  const { body_html: html, body_text: text, ...rest } = email;
  res.json({ ...rest, lines: html ? htmlToLines(html) : textToLines(text ?? '') });
});

app.get('/api/sync', (req, res) => res.json({ ...syncStatus, account: config.imap.user || null }));

app.post('/api/sync', async (req, res) => {
  res.json(await runSync());
});

app.post('/api/reparse', async (req, res) => {
  res.json(await db.reparseAll(parseBcaEmail));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Invalid request body' });
  }
  console.error('[http]', req.method, req.path, err);
  res.status(500).json({ error: 'Internal server error' });
});

async function main() {
  try {
    await db.migrate();
  } catch (err) {
    console.error(`Cannot connect to PostgreSQL (${err.code ?? err.message}). Check DATABASE_URL in .env and that the database exists.`);
    process.exit(1);
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(`Spending monitor running at http://localhost:${config.port}`);
    if (config.publicUrl) console.log(`Also reachable at ${config.publicUrl}`);
    console.log(
      authEnabled
        ? `Google sign-in is on for: ${config.allowedEmails.join(', ')}`
        : 'Google sign-in is off (only this computer can open the dashboard).',
    );
    startSyncLoop();
  });

  const shutdown = () => {
    stopSyncLoop();
    server.close(() => db.pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
