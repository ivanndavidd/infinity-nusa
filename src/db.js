import pg from 'pg';
import { config } from './config.js';
import { categorize } from './categorize.js';

// Return NUMERIC and BIGINT columns as JS numbers (IDR amounts stay well below 2^53).
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });

pool.on('error', (err) => console.error('[db] idle client error:', err.message));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS emails (
  id            BIGSERIAL PRIMARY KEY,
  message_id    TEXT NOT NULL UNIQUE,
  mailbox       TEXT NOT NULL,
  uid           BIGINT,
  sender        TEXT,
  subject       TEXT,
  received_at   TIMESTAMPTZ NOT NULL,
  body_text     TEXT,
  body_html     TEXT,
  dkim_pass     BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL CHECK (status IN ('parsed', 'ignored', 'unparsed')),
  parse_note    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS emails_status_idx ON emails (status, received_at DESC);

CREATE TABLE IF NOT EXISTS transactions (
  id               BIGSERIAL PRIMARY KEY,
  email_id         BIGINT NOT NULL UNIQUE REFERENCES emails(id) ON DELETE CASCADE,
  occurred_at      TIMESTAMPTZ NOT NULL,
  amount           NUMERIC(16, 2) NOT NULL CHECK (amount > 0),
  currency         TEXT NOT NULL DEFAULT 'IDR',
  direction        TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  channel          TEXT,
  merchant         TEXT,
  description      TEXT,
  category         TEXT NOT NULL DEFAULT 'Uncategorized',
  category_locked  BOOLEAN NOT NULL DEFAULT FALSE,
  hidden           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_occurred_at_idx ON transactions (occurred_at DESC);
-- Set once the user hides/unhides a transaction, so re-parsing never overrides that choice.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS hidden_by_user BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS category_rules (
  id          BIGSERIAL PRIMARY KEY,
  pattern     TEXT NOT NULL UNIQUE,
  category    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only a SHA-256 hash of each session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash     TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  mailbox         TEXT PRIMARY KEY,
  uid_validity    TEXT NOT NULL,
  last_uid        BIGINT NOT NULL DEFAULT 0,
  last_synced_at  TIMESTAMPTZ
);

-- Monthly budgets. category '' is the overall monthly budget; other rows are per-category limits.
CREATE TABLE IF NOT EXISTS budgets (
  category  TEXT PRIMARY KEY,
  amount    NUMERIC(16, 2) NOT NULL CHECK (amount > 0)
);

-- Categories created from the dashboard before any transaction uses them.
CREATE TABLE IF NOT EXISTS custom_categories (
  name        TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export async function migrate() {
  await pool.query(SCHEMA);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Whole days $1..$2 (inclusive, 'YYYY-MM-DD') in the configured time zone $3.
function periodWindow(column = 'occurred_at') {
  return `${column} >= ($1::date::timestamp AT TIME ZONE $3)
    AND ${column} < (($2::date + 1)::timestamp AT TIME ZONE $3)`;
}

// ---------- sync state ----------

export async function getSyncState(mailbox) {
  const { rows } = await pool.query('SELECT uid_validity, last_uid FROM sync_state WHERE mailbox = $1', [mailbox]);
  return rows[0] ?? null;
}

export async function saveSyncState(mailbox, uidValidity, lastUid) {
  await pool.query(
    `INSERT INTO sync_state (mailbox, uid_validity, last_uid, last_synced_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (mailbox) DO UPDATE SET uid_validity = $2, last_uid = $3, last_synced_at = now()`,
    [mailbox, uidValidity, lastUid],
  );
}

// ---------- sessions ----------

export async function createSession(idHash, email, days) {
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  await pool.query(
    `INSERT INTO sessions (id_hash, email, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [idHash, email, days],
  );
}

export async function getSessionEmail(idHash) {
  const { rows } = await pool.query('SELECT email FROM sessions WHERE id_hash = $1 AND expires_at > now()', [idHash]);
  return rows[0]?.email ?? null;
}

export async function deleteSession(idHash) {
  await pool.query('DELETE FROM sessions WHERE id_hash = $1', [idHash]);
}

// ---------- emails & transactions ----------

export async function emailExists(messageId) {
  const { rowCount } = await pool.query('SELECT 1 FROM emails WHERE message_id = $1', [messageId]);
  return rowCount > 0;
}

export async function getCategoryRules(client = pool) {
  const { rows } = await client.query('SELECT pattern, category FROM category_rules ORDER BY length(pattern) DESC');
  return rows;
}

async function upsertTransaction(client, emailId, tx, rules) {
  const category = categorize(tx, rules);
  // Card bill payments start hidden: the card purchases themselves are already counted.
  await client.query(
    `INSERT INTO transactions (email_id, occurred_at, amount, currency, direction, channel, merchant, description, category, hidden)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (email_id) DO UPDATE SET
       occurred_at = EXCLUDED.occurred_at, amount = EXCLUDED.amount, currency = EXCLUDED.currency,
       direction = EXCLUDED.direction, channel = EXCLUDED.channel, merchant = EXCLUDED.merchant,
       description = EXCLUDED.description,
       category = CASE WHEN transactions.category_locked THEN transactions.category ELSE EXCLUDED.category END,
       hidden = CASE WHEN transactions.hidden_by_user THEN transactions.hidden ELSE EXCLUDED.hidden END,
       updated_at = now()`,
    [
      emailId, tx.occurredAt, tx.amount, tx.currency, tx.direction, tx.channel, tx.merchant, tx.description, category,
      Boolean(tx.excludeFromTotals),
    ],
  );
}

/** Stores an email and, when it parsed, its transaction. Returns false if the email was already stored. */
export async function saveEmail(email, result) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO emails (message_id, mailbox, uid, sender, subject, received_at, body_text, body_html, dkim_pass, status, parse_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING id`,
      [
        email.messageId, email.mailbox, email.uid, email.sender, email.subject, email.receivedAt,
        email.text, email.html, email.dkimPass, result.status, result.note ?? null,
      ],
    );
    if (rows.length === 0) return false;
    if (result.status === 'parsed') {
      await upsertTransaction(client, rows[0].id, result.transaction, await getCategoryRules(client));
    }
    return true;
  });
}

/** Re-runs the parser over every stored email, e.g. after the parser was improved. */
export async function reparseAll(parse) {
  const { rows: emails } = await pool.query(
    'SELECT id, subject, body_text, body_html, received_at, dkim_pass FROM emails ORDER BY id',
  );
  const counts = { parsed: 0, ignored: 0, unparsed: 0 };
  await withTransaction(async (client) => {
    const rules = await getCategoryRules(client);
    for (const e of emails) {
      const result =
        config.requireDkim && !e.dkim_pass
          ? { status: 'ignored', note: 'DKIM check failed' }
          : parse({ subject: e.subject ?? '', text: e.body_text ?? '', html: e.body_html ?? '', date: e.received_at });
      counts[result.status]++;
      await client.query('UPDATE emails SET status = $2, parse_note = $3 WHERE id = $1', [e.id, result.status, result.note ?? null]);
      if (result.status === 'parsed') await upsertTransaction(client, e.id, result.transaction, rules);
      else await client.query('DELETE FROM transactions WHERE email_id = $1', [e.id]);
    }
  });
  return counts;
}

export async function listEmails(status, limit = 100) {
  const { rows } = await pool.query(
    `SELECT e.id, e.sender, e.subject, e.received_at, e.status, e.parse_note, e.dkim_pass,
            t.amount, t.currency, t.direction, t.merchant, t.description, t.channel, t.category
     FROM emails e LEFT JOIN transactions t ON t.email_id = e.id
     WHERE ($1::text IS NULL OR e.status = $1)
     ORDER BY e.received_at DESC LIMIT $2`,
    [status, limit],
  );
  return rows;
}

/** Counted spending that still has no category, across all time. */
export async function uncategorizedCount() {
  const { rows } = await pool.query(
    `SELECT count(*) AS n FROM transactions WHERE category = 'Uncategorized' AND direction = 'debit' AND NOT hidden`,
  );
  return rows[0].n;
}

/** How many recorded transactions each channel (QRIS, Transfer, ...) has, across all time. */
export async function channelCounts() {
  const { rows } = await pool.query(
    `SELECT COALESCE(channel, 'Other') AS channel, count(*) AS count FROM transactions GROUP BY 1 ORDER BY 2 DESC`,
  );
  return rows;
}

export async function getEmail(id) {
  const { rows } = await pool.query(
    'SELECT id, sender, subject, received_at, status, parse_note, dkim_pass, body_text, body_html FROM emails WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

export async function emailCounts() {
  const { rows } = await pool.query('SELECT status, count(*) AS count FROM emails GROUP BY status');
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

// ---------- dashboard queries ----------

export async function listMonths() {
  const { rows } = await pool.query(
    `SELECT DISTINCT to_char(occurred_at AT TIME ZONE $1, 'YYYY-MM') AS month FROM transactions ORDER BY month DESC`,
    [config.timezone],
  );
  return rows.map((r) => r.month);
}

export async function getSummary({ from, to }) {
  const params = [from, to, config.timezone];
  const base = `FROM transactions WHERE NOT hidden AND currency = 'IDR' AND ${periodWindow()}`;
  const [totals, byCategory, byDay, topMerchants] = await Promise.all([
    pool.query(
      `SELECT
         COALESCE(sum(amount) FILTER (WHERE direction = 'debit'), 0) AS spent,
         COALESCE(sum(amount) FILTER (WHERE direction = 'credit'), 0) AS income,
         count(*) FILTER (WHERE direction = 'debit') AS debit_count,
         count(*) AS count
       ${base}`,
      params,
    ),
    pool.query(
      `SELECT category, sum(amount) AS total, count(*) AS count ${base} AND direction = 'debit'
       GROUP BY category ORDER BY total DESC`,
      params,
    ),
    pool.query(
      `SELECT to_char(occurred_at AT TIME ZONE $3, 'YYYY-MM-DD') AS day, sum(amount) AS total
       ${base} AND direction = 'debit' GROUP BY day ORDER BY day`,
      params,
    ),
    pool.query(
      `SELECT COALESCE(merchant, '(unknown)') AS merchant, sum(amount) AS total, count(*) AS count
       ${base} AND direction = 'debit' GROUP BY 1 ORDER BY total DESC LIMIT 5`,
      params,
    ),
  ]);
  return {
    from,
    to,
    ...totals.rows[0],
    byCategory: byCategory.rows,
    byDay: byDay.rows,
    topMerchants: topMerchants.rows,
  };
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listTransactions({ from, to, q, category }) {
  const { rows } = await pool.query(
    `SELECT t.id, t.occurred_at, t.amount, t.currency, t.direction, t.channel, t.merchant, t.description,
            t.category, t.category_locked, t.hidden, t.email_id, e.subject AS email_subject
     FROM transactions t JOIN emails e ON e.id = t.email_id
     WHERE ${periodWindow('t.occurred_at')}
       AND ($4::text IS NULL OR t.merchant ILIKE $4 OR t.description ILIKE $4 OR e.subject ILIKE $4)
       AND ($5::text IS NULL OR t.category = $5)
     ORDER BY t.occurred_at DESC
     LIMIT 5000`,
    [from, to, config.timezone, q ? `%${escapeLike(q)}%` : null, category || null],
  );
  return rows;
}

export async function listCategories() {
  const { rows } = await pool.query(
    `SELECT DISTINCT category FROM transactions
     UNION SELECT DISTINCT category FROM category_rules
     UNION SELECT name FROM custom_categories
     UNION SELECT category FROM budgets WHERE category <> ''
     ORDER BY 1`,
  );
  return rows.map((r) => r.category);
}

export async function addCategory(name) {
  await pool.query('INSERT INTO custom_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [name]);
}

// ---------- auto-categorize rules ----------

export async function listRules() {
  const { rows } = await pool.query(
    `SELECT r.id, r.pattern, r.category,
            (SELECT count(*) FROM transactions t WHERE position(lower(r.pattern) IN lower(COALESCE(t.merchant, ''))) > 0) AS matches
     FROM category_rules r ORDER BY matches DESC, r.pattern`,
  );
  return rows;
}

/** Saves a merchant rule and files every matching transaction the user hasn't categorized by hand. */
export async function addRule(pattern, category) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO category_rules (pattern, category) VALUES ($1, $2)
       ON CONFLICT (pattern) DO UPDATE SET category = $2
       RETURNING id, pattern, category`,
      [pattern.toLowerCase(), category],
    );
    const res = await client.query(
      `UPDATE transactions SET category = $2, updated_at = now()
       WHERE NOT category_locked AND position($1 IN lower(COALESCE(merchant, ''))) > 0`,
      [pattern.toLowerCase(), category],
    );
    return { ...rows[0], updated: res.rowCount };
  });
}

/** Removes a rule. Transactions it already filed keep their category. */
export async function deleteRule(id) {
  const { rowCount } = await pool.query('DELETE FROM category_rules WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------- budgets ----------

export async function getBudgets() {
  const { rows } = await pool.query('SELECT category, amount FROM budgets ORDER BY category');
  const categories = {};
  let total = null;
  for (const r of rows) {
    if (r.category === '') total = r.amount;
    else categories[r.category] = r.amount;
  }
  return { total, categories };
}

/** Replaces every budget. A missing total or category means "no budget". */
export async function setBudgets({ total, categories }) {
  await withTransaction(async (client) => {
    await client.query('DELETE FROM budgets');
    if (total) await client.query(`INSERT INTO budgets (category, amount) VALUES ('', $1)`, [total]);
    for (const [category, amount] of Object.entries(categories)) {
      await client.query('INSERT INTO budgets (category, amount) VALUES ($1, $2)', [category, amount]);
    }
  });
  return getBudgets();
}

// ---------- review queue ----------

/**
 * Spending in the period that no rule could categorize, newest first, each with a suggested category:
 * the category most often used for the same kind of payment (QRIS, Transfer, ...).
 */
export async function listReviewQueue({ from, to }) {
  const [queue, stats] = await Promise.all([
    pool.query(
      `SELECT t.id, t.occurred_at, t.amount, t.currency, t.channel, t.merchant, t.description, e.subject AS email_subject
       FROM transactions t JOIN emails e ON e.id = t.email_id
       WHERE ${periodWindow('t.occurred_at')} AND t.category = 'Uncategorized' AND t.direction = 'debit' AND NOT t.hidden
       ORDER BY t.occurred_at DESC LIMIT 200`,
      [from, to, config.timezone],
    ),
    pool.query(
      `SELECT COALESCE(channel, '') AS channel, category, count(*) AS n
       FROM transactions
       WHERE direction = 'debit' AND category NOT IN ('Uncategorized', 'Credit Card Bill')
       GROUP BY 1, 2`,
    ),
  ]);
  const byChannel = new Map();
  for (const { channel, category, n } of stats.rows) {
    const s = byChannel.get(channel) ?? { total: 0, best: null, bestN: 0 };
    s.total += n;
    if (n > s.bestN) Object.assign(s, { best: category, bestN: n });
    byChannel.set(channel, s);
  }
  return queue.rows.map((tx) => {
    const s = byChannel.get(tx.channel ?? '');
    return { ...tx, suggestion: s?.best ?? null, confidence: s ? Math.round((s.bestN / s.total) * 100) : null };
  });
}

export async function updateTransaction(id, { category, hidden, applyToMerchant }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE transactions SET
         category = COALESCE($2, category),
         category_locked = category_locked OR $2::text IS NOT NULL,
         hidden = COALESCE($3, hidden),
         hidden_by_user = hidden_by_user OR $3::boolean IS NOT NULL,
         updated_at = now()
       WHERE id = $1
       RETURNING id, merchant, category, hidden`,
      [id, category ?? null, hidden ?? null],
    );
    const tx = rows[0];
    if (!tx) return null;

    let updatedOthers = 0;
    if (category && applyToMerchant && tx.merchant) {
      const pattern = tx.merchant.toLowerCase();
      await client.query(
        `INSERT INTO category_rules (pattern, category) VALUES ($1, $2)
         ON CONFLICT (pattern) DO UPDATE SET category = $2`,
        [pattern, category],
      );
      const res = await client.query(
        `UPDATE transactions SET category = $2, updated_at = now()
         WHERE NOT category_locked AND id <> $3 AND merchant ILIKE $1`,
        [`%${escapeLike(pattern)}%`, category, id],
      );
      updatedOthers = res.rowCount;
    }
    return { ...tx, updatedOthers };
  });
}
