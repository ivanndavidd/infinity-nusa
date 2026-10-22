import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config, imapConfigured } from './config.js';
import * as db from './db.js';
import { parseBcaEmail } from './parser/index.js';

const FETCH_CHUNK = 50;
const MAX_RETRY_SECONDS = 30 * 60;

export const syncStatus = {
  enabled: imapConfigured,
  mailbox: config.imap.mailbox,
  intervalSeconds: config.syncIntervalSeconds,
  running: false,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null,
  consecutiveFailures: 0,
  nextRunAt: null,
};

const senderDomains = config.senders.map((s) => (s.includes('@') ? s.split('@')[1] : s));

function domainMatches(domain) {
  return senderDomains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function senderMatches(address) {
  const addr = address.toLowerCase();
  return config.senders.some((s) => (s.includes('@') ? addr === s : domainMatches(addr.split('@')[1] ?? '')));
}

// True when the receiving provider (e.g. Gmail) recorded a passing DKIM signature from a BCA domain.
function dkimPassed(headerLines = []) {
  return headerLines
    .filter((h) => h.key === 'authentication-results')
    .some((h) => [...h.line.matchAll(/dkim=pass[^;]*?header\.[di]=@?([a-z0-9.-]+)/gi)].some((m) => domainMatches(m[1].toLowerCase())));
}

function senderQuery() {
  return config.senders.length === 1
    ? { from: config.senders[0] }
    : { or: config.senders.map((s) => ({ from: s })) };
}

function describeError(err) {
  if (err.authenticationFailed) {
    const reason = String(err.response ?? err.responseText ?? '').trim();
    return `IMAP login refused${reason ? ` (server said: ${reason})` : ''}. Check IMAP_USER and IMAP_PASSWORD (Gmail needs an App Password).`;
  }
  if (err.serverResponseCode === 'NONEXISTENT') return `Mailbox "${config.imap.mailbox}" does not exist. Check IMAP_MAILBOX.`;
  if (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return `Cannot reach ${config.imap.host}:${config.imap.port} (${err.code}).`;
  }
  return err.responseText || err.message || String(err);
}

async function processMessage({ uid, source }, uidValidity, counts) {
  const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const sender = mail.from?.value?.[0]?.address?.toLowerCase() ?? '';
  if (!senderMatches(sender)) {
    counts.skipped++;
    return;
  }

  const messageId = mail.messageId || `${config.imap.mailbox}:${uidValidity}:${uid}`;
  if (await db.emailExists(messageId)) {
    counts.skipped++;
    return;
  }

  const email = {
    messageId,
    mailbox: config.imap.mailbox,
    uid,
    sender,
    subject: mail.subject ?? '',
    receivedAt: mail.date ?? new Date(),
    text: mail.text ?? '',
    html: typeof mail.html === 'string' ? mail.html : '',
    dkimPass: dkimPassed(mail.headerLines),
  };
  const result =
    config.requireDkim && !email.dkimPass
      ? { status: 'ignored', note: 'DKIM check failed' }
      : parseBcaEmail({ subject: email.subject, text: email.text, html: email.html, date: email.receivedAt });

  if (await db.saveEmail(email, result)) counts[result.status]++;
  else counts.skipped++;
}

async function syncOnce() {
  const counts = { found: 0, parsed: 0, ignored: 0, unparsed: 0, skipped: 0 };
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: { user: config.imap.user, pass: config.imap.pass },
    logger: false,
  });
  client.on('error', (err) => console.error(`${new Date().toISOString()} [sync] IMAP connection error:`, describeError(err)));

  try {
    await client.connect();
    // Read-only: never marks the emails as read or changes anything in the mailbox.
    const lock = await client.getMailboxLock(config.imap.mailbox, { readOnly: true });
    try {
      const { uidValidity, uidNext } = client.mailbox;
      const validity = String(uidValidity);
      const state = await db.getSyncState(config.imap.mailbox);
      const lastUid = state && state.uid_validity === validity ? state.last_uid : 0;

      const query = senderQuery();
      if (lastUid > 0) query.uid = `${lastUid + 1}:*`;
      else query.since = new Date(Date.now() - config.initialSyncDays * 86_400_000);

      const uids = ((await client.search(query, { uid: true })) || []).filter((u) => u > lastUid).sort((a, b) => a - b);
      counts.found = uids.length;

      let maxUid = lastUid;
      for (let i = 0; i < uids.length; i += FETCH_CHUNK) {
        const chunk = uids.slice(i, i + FETCH_CHUNK);
        const messages = [];
        for await (const msg of client.fetch(chunk, { uid: true, source: true }, { uid: true })) {
          messages.push({ uid: msg.uid, source: msg.source });
        }
        messages.sort((a, b) => a.uid - b.uid);
        for (const msg of messages) {
          await processMessage(msg, validity, counts);
          maxUid = Math.max(maxUid, msg.uid);
        }
        await db.saveSyncState(config.imap.mailbox, validity, maxUid);
      }
      // Everything before uidNext has been searched, so later runs only need to look at newer messages.
      const searchedUpTo = Number(uidNext) - 1;
      await db.saveSyncState(config.imap.mailbox, validity, Number.isFinite(searchedUpTo) ? Math.max(maxUid, searchedUpTo) : maxUid);
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    client.close();
    throw err;
  }
  return counts;
}

export async function runSync() {
  if (!imapConfigured || syncStatus.running) return syncStatus;
  syncStatus.running = true;
  syncStatus.lastRunAt = new Date();
  try {
    syncStatus.lastResult = await syncOnce();
    syncStatus.lastSuccessAt = new Date();
    syncStatus.lastError = null;
    syncStatus.consecutiveFailures = 0;
    const r = syncStatus.lastResult;
    if (r.found > 0) {
      console.log(`${new Date().toISOString()} [sync] ${r.found} new BCA email(s): ${r.parsed} parsed, ${r.ignored} ignored, ${r.unparsed} unparsed, ${r.skipped} skipped`);
    }
  } catch (err) {
    syncStatus.lastError = describeError(err);
    syncStatus.consecutiveFailures = (syncStatus.consecutiveFailures ?? 0) + 1;
    console.error(`${new Date().toISOString()} [sync] failed:`, syncStatus.lastError);
  } finally {
    syncStatus.running = false;
  }
  return syncStatus;
}

let timer = null;

export function startSyncLoop() {
  if (!imapConfigured) {
    console.warn('[sync] IMAP_USER / IMAP_PASSWORD not set: email sync is off. Fill them in .env and restart.');
    return;
  }
  const tick = async () => {
    await runSync();
    // Back off after failures (doubling, up to 30 minutes) so repeated bad logins don't get the account blocked.
    const failures = syncStatus.consecutiveFailures ?? 0;
    const delaySeconds = Math.min(config.syncIntervalSeconds * 2 ** failures, MAX_RETRY_SECONDS);
    syncStatus.nextRunAt = new Date(Date.now() + delaySeconds * 1000);
    timer = setTimeout(tick, delaySeconds * 1000);
  };
  tick();
}

export function stopSyncLoop() {
  clearTimeout(timer);
}
