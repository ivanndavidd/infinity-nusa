try {
  process.loadEnvFile();
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

function str(name, fallback = '') {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

function int(name, fallback) {
  const raw = str(name);
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

function bool(name, fallback) {
  const raw = str(name).toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

const databaseUrl = str('DATABASE_URL');
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
}

export const config = {
  host: str('HOST', '127.0.0.1'),
  port: int('PORT', 3000),
  databaseUrl,
  timezone: str('TIMEZONE', 'Asia/Jakarta'),
  imap: {
    host: str('IMAP_HOST', 'imap.gmail.com'),
    port: int('IMAP_PORT', 993),
    secure: bool('IMAP_SECURE', true),
    user: str('IMAP_USER'),
    pass: str('IMAP_PASSWORD'),
    mailbox: str('IMAP_MAILBOX', 'INBOX'),
  },
  senders: str('BCA_SENDERS', 'bca.co.id')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  syncIntervalSeconds: Math.max(int('SYNC_INTERVAL_SECONDS', 60), 15),
  initialSyncDays: int('INITIAL_SYNC_DAYS', 90),
  requireDkim: bool('REQUIRE_DKIM', false),
  google: {
    clientId: str('GOOGLE_CLIENT_ID'),
    clientSecret: str('GOOGLE_CLIENT_SECRET'),
  },
  allowedEmails: str('ALLOWED_EMAILS')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  publicUrl: str('PUBLIC_URL').replace(/\/+$/, ''),
  // The forecast page's AI analysis; without a key the page shows the statistical forecast only.
  deepseek: {
    apiKey: str('DEEPSEEK_API_KEY'),
    model: str('DEEPSEEK_MODEL', 'deepseek-flash'),
    baseUrl: str('DEEPSEEK_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
  },
};

export const imapConfigured = Boolean(config.imap.user && config.imap.pass);
export const authEnabled = Boolean(config.google.clientId && config.google.clientSecret);
export const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

// Fail closed: never expose the dashboard beyond this computer without Google sign-in.
if (authEnabled && config.allowedEmails.length === 0) {
  throw new Error('ALLOWED_EMAILS must list the Google account(s) allowed to sign in.');
}
if (config.publicUrl) {
  let url;
  try {
    url = new URL(config.publicUrl);
  } catch {
    throw new Error('PUBLIC_URL must be a full URL such as https://my-pc.example.ts.net');
  }
  if (url.protocol !== 'https:') throw new Error('PUBLIC_URL must start with https://');
  if (!authEnabled) throw new Error('PUBLIC_URL needs Google sign-in: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
  config.publicHostname = url.hostname.toLowerCase();
}
if (!LOCAL_HOSTNAMES.has(config.host) && !authEnabled) {
  throw new Error(`HOST=${config.host} makes the dashboard reachable from other devices; set up Google sign-in first.`);
}
