// "Sign in with Google" (OpenID Connect authorization-code flow with PKCE) and cookie sessions.
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { authEnabled, config } from './config.js';
import * as db from './db.js';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const SESSION_COOKIE = 'sm_session';
const STATE_COOKIE = 'sm_oauth_state';
const SESSION_DAYS = 30;
const LOGIN_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_LOGINS = 50;
const LOGIN_PAGE = fileURLToPath(new URL('../public/login.html', import.meta.url));
const PUBLIC_PATHS = new Set(['/login.js', '/styles.css', '/fonts/PlusJakartaSans.ttf', '/favicon.svg', '/logo.svg']);

// Sign-ins in progress, keyed by OAuth state. Lost on restart, which only means clicking "Sign in" again.
const pendingLogins = new Map();

const sha256 = (value) => createHash('sha256').update(value).digest();
const hashToken = (value) => sha256(value).toString('hex');
const newToken = (bytes) => randomBytes(bytes).toString('base64url');

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore malformed cookies
    }
  }
  return cookies;
}

/** True when the request arrived through PUBLIC_URL (e.g. a Tailscale HTTPS address) rather than localhost. */
export function isPublicRequest(req) {
  return Boolean(config.publicHostname) && req.hostname === config.publicHostname;
}

function baseUrl(req) {
  return isPublicRequest(req) ? config.publicUrl : `http://localhost:${config.port}`;
}

function cookieOptions(req, maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: isPublicRequest(req), path: '/', maxAge };
}

function decodeJwtPayload(jwt) {
  const parts = typeof jwt === 'string' ? jwt.split('.') : [];
  if (parts.length !== 3) throw new Error('malformed ID token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

const loginError = (res, code) => res.redirect(`/login?error=${code}`);

// Strict, so "/login/" doesn't serve the page at a depth where its relative asset links break.
export const authRouter = express.Router({ strict: true });

// The sign-in page lives at /login; the old /login.html address (bookmarks, open tabs) redirects there.
authRouter.get('/login', (req, res) => (authEnabled ? res.sendFile(LOGIN_PAGE) : res.redirect('/')));
authRouter.get('/login.html', (req, res) => {
  const query = req.originalUrl.indexOf('?');
  res.redirect(query < 0 ? '/login' : `/login${req.originalUrl.slice(query)}`);
});

authRouter.get('/auth/login', (req, res) => {
  if (!authEnabled) return res.redirect('/');
  // Google only redirects back to addresses registered on the OAuth client, so local sign-in always uses "localhost".
  if (!isPublicRequest(req) && req.hostname !== 'localhost') {
    return res.redirect(`http://localhost:${config.port}/auth/login`);
  }

  const now = Date.now();
  for (const [key, login] of pendingLogins) {
    if (login.expires < now || pendingLogins.size >= MAX_PENDING_LOGINS) pendingLogins.delete(key);
  }
  const state = newToken(24);
  const verifier = newToken(32);
  const nonce = newToken(16);
  const redirectUri = `${baseUrl(req)}/auth/callback`;
  pendingLogins.set(state, { verifier, nonce, redirectUri, expires: now + LOGIN_TTL_MS });
  res.cookie(STATE_COOKIE, state, cookieOptions(req, LOGIN_TTL_MS));

  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email',
    state,
    nonce,
    code_challenge: sha256(verifier).toString('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  res.redirect(url.toString());
});

authRouter.get('/auth/callback', async (req, res) => {
  if (!authEnabled) return res.redirect('/');
  const { code, state, error } = req.query;
  const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE, { path: '/' });
  if (error) return loginError(res, 'cancelled');

  const login = typeof state === 'string' ? pendingLogins.get(state) : undefined;
  if (login) pendingLogins.delete(state);
  if (!login || state !== cookieState || login.expires < Date.now() || typeof code !== 'string') {
    return loginError(res, 'expired');
  }

  let claims;
  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: login.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: login.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !body.id_token) throw new Error(`token exchange failed (${tokenRes.status} ${body.error ?? ''})`);
    // The ID token comes straight from Google's token endpoint over TLS, so its claims are checked
    // instead of its signature (OpenID Connect Core 3.1.3.7).
    claims = decodeJwtPayload(body.id_token);
  } catch (err) {
    console.error('[auth] Google sign-in failed:', err.message);
    return loginError(res, 'failed');
  }

  const valid =
    GOOGLE_ISSUERS.has(claims.iss) &&
    claims.aud === config.google.clientId &&
    Number(claims.exp) * 1000 > Date.now() &&
    claims.nonce === login.nonce &&
    claims.email_verified === true &&
    typeof claims.email === 'string';
  if (!valid) {
    console.warn('[auth] rejected an ID token with unexpected claims');
    return loginError(res, 'failed');
  }
  const email = claims.email.toLowerCase();
  if (!config.allowedEmails.includes(email)) {
    console.warn(`[auth] sign-in refused for ${email} (not in ALLOWED_EMAILS)`);
    return loginError(res, 'denied');
  }

  const sessionToken = newToken(32);
  await db.createSession(hashToken(sessionToken), email, SESSION_DAYS);
  res.cookie(SESSION_COOKIE, sessionToken, cookieOptions(req, SESSION_DAYS * 86_400_000));
  res.redirect('/');
});

authRouter.post('/api/logout', async (req, res) => {
  const sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (sessionToken) await db.deleteSession(hashToken(sessionToken));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/** Lets a request through only with a valid session for an allowed Google account (when sign-in is configured). */
export async function requireAuth(req, res, next) {
  if (!authEnabled || PUBLIC_PATHS.has(req.path)) return next();

  const sessionToken = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  const email = sessionToken ? await db.getSessionEmail(hashToken(sessionToken)) : null;
  // Checked on every request, so removing an address from ALLOWED_EMAILS locks it out immediately.
  if (email && config.allowedEmails.includes(email)) {
    req.user = { email };
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in required' });
  res.redirect('/login');
}
