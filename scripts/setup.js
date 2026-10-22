// Interactive first-time setup: creates the database and a dedicated app login, saves and tests the mailbox
// settings, and optionally starts the app at Windows logon. Secrets are typed here and only written to .env.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { ImapFlow } from 'imapflow';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const APP_ROLE = 'spending_app';
const APP_DB = 'spending';
const TASK_NAME = 'Spending Monitor';

// ---------- prompts ----------

const interactive = Boolean(process.stdin.isTTY);
let pipedLines;

async function readLine(prompt) {
  if (interactive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }
  // Answers piped in (scripted runs): read them from one shared line reader.
  process.stdout.write(prompt);
  pipedLines ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const { value, done } = await pipedLines.next();
  if (done) throw new Error('No more input.');
  process.stdout.write('\n');
  return value;
}

async function ask(question, fallback = '') {
  const answer = (await readLine(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim();
  return answer || fallback;
}

async function confirm(question, yesByDefault = true) {
  const answer = (await ask(`${question} (${yesByDefault ? 'Y/n' : 'y/N'})`)).toLowerCase();
  return answer ? answer.startsWith('y') : yesByDefault;
}

// Reads a line without echoing it (prints * per character).
function askHidden(question) {
  const { stdin, stdout } = process;
  if (!interactive) return readLine(question);
  return new Promise((resolve) => {
    stdout.write(question);
    let value = '';
    const done = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          done();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          done();
          process.exit(130);
        }
        if (ch === '\u007f' || ch === '\b') {
          if (value) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else if (ch >= ' ') {
          value += ch;
          stdout.write('*');
        }
      }
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    stdin.on('data', onData);
  });
}

// ---------- .env ----------

function readEnv() {
  if (!existsSync(envPath)) copyFileSync(path.join(root, '.env.example'), envPath);
  return readFileSync(envPath, 'utf8');
}

function envValue(text, key) {
  const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : '';
}

function formatValue(value) {
  if (/^[\w@.:/+=-]*$/.test(value)) return value;
  return value.includes("'") ? `"${value}"` : `'${value}'`;
}

function setEnv(text, values) {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${formatValue(String(value))}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    out = re.test(out) ? out.replace(re, () => line) : `${out.trimEnd()}\n${line}\n`;
  }
  writeFileSync(envPath, out);
  return out;
}

// ---------- step 1: database ----------

async function canConnect(connectionString) {
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

async function setupDatabase(env) {
  console.log('\nStep 1 of 4: Database');
  const existing = envValue(env, 'DATABASE_URL');
  if (existing && (await canConnect(existing))) {
    console.log('  ✓ DATABASE_URL in .env already works.');
    if (await confirm('  Keep it?')) return env;
  }

  const host = await ask('  PostgreSQL host', 'localhost');
  const port = Number(await ask('  PostgreSQL port', '5432'));
  const adminUser = await ask('  PostgreSQL admin user', 'postgres');

  for (let attempt = 1; attempt <= 3; attempt++) {
    const adminPassword = await askHidden(`  Password for "${adminUser}" (chosen when PostgreSQL was installed): `);
    const admin = new pg.Client({ host, port, user: adminUser, password: adminPassword, database: 'postgres' });
    try {
      await admin.connect();
    } catch (err) {
      console.log(`  ✗ ${err.message}`);
      await admin.end().catch(() => {});
      continue;
    }

    const appPassword = randomBytes(24).toString('hex');
    try {
      const roleExists = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_ROLE])).rowCount > 0;
      await admin.query(`${roleExists ? 'ALTER' : 'CREATE'} ROLE ${APP_ROLE} WITH LOGIN PASSWORD ${admin.escapeLiteral(appPassword)}`);
      const dbExists = (await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [APP_DB])).rowCount > 0;
      await admin.query(dbExists ? `ALTER DATABASE ${APP_DB} OWNER TO ${APP_ROLE}` : `CREATE DATABASE ${APP_DB} OWNER ${APP_ROLE}`);
    } finally {
      await admin.end();
    }

    const url = `postgres://${APP_ROLE}:${appPassword}@${host}:${port}/${APP_DB}`;
    if (!(await canConnect(url))) throw new Error(`Created the "${APP_ROLE}" login but could not connect with it.`);
    console.log(`  ✓ Database "${APP_DB}" is ready. The app signs in as "${APP_ROLE}" with its own generated password.`);
    console.log('    (Your admin password was only used for this step and is not saved.)');
    return setEnv(env, { DATABASE_URL: url });
  }
  throw new Error('Could not sign in to PostgreSQL after 3 tries.');
}

// ---------- step 2: mailbox ----------

async function testMailbox({ host, port, secure, user, pass, mailbox, senders }) {
  const client = new ImapFlow({ host, port, secure, auth: { user, pass }, logger: false });
  client.on('error', () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock(mailbox, { readOnly: true });
    try {
      const since = new Date(Date.now() - 90 * 86_400_000);
      const query = senders.length === 1 ? { from: senders[0], since } : { or: senders.map((s) => ({ from: s })), since };
      const found = (await client.search(query, { uid: true })) || [];
      return { ok: true, count: found.length };
    } finally {
      lock.release();
      await client.logout().catch(() => {});
    }
  } catch (err) {
    client.close();
    if (err.authenticationFailed) return { ok: false, error: 'Login failed: wrong email address or App Password.' };
    if (err.serverResponseCode === 'NONEXISTENT') return { ok: false, error: `Folder "${mailbox}" does not exist.` };
    return { ok: false, error: err.responseText || err.message };
  }
}

async function setupMailbox(env) {
  console.log('\nStep 2 of 4: Mailbox that receives your BCA emails');
  let mailbox = envValue(env, 'IMAP_MAILBOX') || 'INBOX';
  const port = Number(envValue(env, 'IMAP_PORT') || 993);
  const secure = (envValue(env, 'IMAP_SECURE') || 'true') !== 'false';
  const senders = (envValue(env, 'BCA_SENDERS') || 'bca.co.id').split(',').map((s) => s.trim()).filter(Boolean);

  const saved = { host: envValue(env, 'IMAP_HOST'), user: envValue(env, 'IMAP_USER'), pass: envValue(env, 'IMAP_PASSWORD') };
  if (saved.host && saved.user && saved.pass) {
    const check = await testMailbox({ ...saved, port, secure, mailbox, senders });
    if (check.ok) {
      console.log(`  ✓ ${saved.user} already works (${check.count} BCA email(s) in the last 90 days).`);
      if (await confirm('  Keep it?')) return env;
    }
  }

  console.log('  For Gmail you need an App Password (not your normal password):');
  console.log('    1. Make sure 2-Step Verification is on for that Google account');
  console.log('    2. Create one at https://myaccount.google.com/apppasswords (name it "Spending Monitor")');

  const host = await ask('  IMAP server', saved.host || 'imap.gmail.com');
  const user = await ask('  Email address', saved.user);
  const isGmail = /gmail\.com$/i.test(host);

  for (let attempt = 1; attempt <= 3; attempt++) {
    let pass = await askHidden(isGmail ? '  App Password: ' : '  Password: ');
    if (isGmail) pass = pass.replace(/\s+/g, '');
    process.stdout.write('  Checking… ');
    let result = await testMailbox({ host, port, secure, user, pass, mailbox, senders });

    if (result.ok && result.count === 0 && isGmail && mailbox === 'INBOX') {
      // BCA emails may have been archived or filtered out of the inbox.
      const all = await testMailbox({ host, port, secure, user, pass, mailbox: '[Gmail]/All Mail', senders });
      if (all.ok && all.count > 0) {
        mailbox = '[Gmail]/All Mail';
        result = all;
      }
    }

    if (!result.ok) {
      console.log(`✗ ${result.error}`);
      continue;
    }
    console.log(`✓ Signed in. Found ${result.count} BCA email(s) from the last 90 days in "${mailbox}".`);
    if (result.count === 0) {
      console.log('    No BCA emails yet: turn on email notifications in myBCA (Settings → Notifications → Email).');
      console.log('    New ones will be picked up automatically once they arrive.');
    }
    return setEnv(env, { IMAP_HOST: host, IMAP_USER: user, IMAP_PASSWORD: pass, IMAP_MAILBOX: mailbox });
  }

  console.log('  Mailbox not saved. Run "npm run setup" again when you have the right App Password.');
  return env;
}

// ---------- step 3: Google sign-in ----------

// Sends a made-up authorization code: Google answers "invalid_client" when the client ID/secret pair is wrong,
// and a different error (e.g. "invalid_grant") when the pair itself is valid.
async function checkGoogleClient(clientId, clientSecret, redirectUri) {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: 'setup-check',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => ({}));
    if (body.error === 'invalid_client' || body.error === 'unauthorized_client') {
      return { ok: false, error: body.error_description || 'Client ID or secret is wrong.' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `Could not reach Google (${err.message}).` };
  }
}

async function askPublicUrl(current) {
  for (;;) {
    const value = (await ask('  Phone address (https://…, or leave empty for now)', current)).replace(/\/+$/, '');
    if (!value) return '';
    try {
      if (new URL(value).protocol === 'https:') return value;
    } catch {
      // fall through
    }
    console.log('  ✗ It must be a full https:// address, e.g. https://my-pc.your-tailnet.ts.net');
    current = '';
  }
}

async function setupGoogle(env) {
  console.log('\nStep 3 of 4: Sign in with Google');
  if (envValue(env, 'GOOGLE_CLIENT_ID') && envValue(env, 'GOOGLE_CLIENT_SECRET')) {
    console.log(`  ✓ Already on for ${envValue(env, 'ALLOWED_EMAILS')}${envValue(env, 'PUBLIC_URL') ? `, phone address ${envValue(env, 'PUBLIC_URL')}` : ''}.`);
    if (await confirm('  Keep it?')) return env;
  } else if (!(await confirm('  Require Google sign-in to open the dashboard? (needed to use it on your phone)'))) {
    console.log('  Skipped. The dashboard stays open to this computer only.');
    return env;
  }

  const port = envValue(env, 'PORT') || '3000';
  console.log('  If you will open the dashboard on your phone, enter its HTTPS address now (README → "Phone access").');
  const publicUrl = await askPublicUrl(envValue(env, 'PUBLIC_URL'));
  const allowed = (await ask('  Google account allowed in', envValue(env, 'ALLOWED_EMAILS') || envValue(env, 'IMAP_USER'))).toLowerCase();
  const redirectUris = [`http://localhost:${port}/auth/callback`, ...(publicUrl ? [`${publicUrl}/auth/callback`] : [])];

  console.log(`
  Create a Google OAuth client (signed in to Google Cloud as ${allowed || 'your Google account'}):
    1. https://console.cloud.google.com/projectcreate  → create a project, e.g. "Spending Monitor"
    2. https://console.cloud.google.com/auth/overview  → Get started: app name "Spending Monitor",
       your email as support/contact email, Audience "External"
    3. Audience → Test users → add ${allowed || 'your Google account'}
    4. https://console.cloud.google.com/apis/credentials → Create credentials → OAuth client ID
       → Application type "Web application" → Authorized redirect URIs:
${redirectUris.map((u) => `         ${u}`).join('\n')}
    5. Copy the Client ID and Client secret it shows you.`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const clientId = await ask('  Client ID');
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      console.log('  ✗ A Client ID ends in ".apps.googleusercontent.com".');
      continue;
    }
    const clientSecret = await askHidden('  Client secret: ');
    process.stdout.write('  Checking… ');
    const check = await checkGoogleClient(clientId, clientSecret, redirectUris[0]);
    if (!check.ok) {
      console.log(`✗ ${check.error}`);
      continue;
    }
    console.log(`✓ Google accepted the client. Only ${allowed} can sign in.`);
    return setEnv(env, {
      GOOGLE_CLIENT_ID: clientId,
      GOOGLE_CLIENT_SECRET: clientSecret,
      ALLOWED_EMAILS: allowed,
      PUBLIC_URL: publicUrl,
    });
  }

  console.log('  Google sign-in not saved. Run "npm run setup" again when you have the Client ID and secret.');
  return env;
}

// ---------- step 4: background start ----------

const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;

// PowerShell that starts the server with no window, logging to logs\.
// Does nothing when something already listens on the port, so it never starts a second copy or wipes its logs.
// If the server doesn't come up within ~30s (e.g. PostgreSQL still starting after a reboot), it tries again
// every minute, 4 attempts in all, then exits 1.
export function buildStartCommand(appRoot, nodePath, port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`);
  const logs = path.join(appRoot, 'logs');
  return [
    `function up { [bool](Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) }`,
    `New-Item -ItemType Directory -Force -Path ${psQuote(logs)} | Out-Null`,
    'foreach ($try in 1..4) { if ($try -gt 1) { Start-Sleep -Seconds 60 }; if (up) { exit 0 }; ' +
      `$p = Start-Process -FilePath ${psQuote(nodePath)} -ArgumentList 'src/server.js' -WorkingDirectory ${psQuote(appRoot)} -WindowStyle Hidden -PassThru` +
      ` -RedirectStandardOutput ${psQuote(path.join(logs, 'server.log'))} -RedirectStandardError ${psQuote(path.join(logs, 'server-error.log'))}; ` +
      'foreach ($i in 1..60) { if (up) { exit 0 }; if ($p.HasExited) { break }; Start-Sleep -Milliseconds 500 }; ' +
      'if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force } }',
    'exit 1',
  ].join('; ');
}

// powershell.exe arguments used by the logon task / Startup shortcut.
export function buildActionArgs(startCommand) {
  return `-NoProfile -WindowStyle Hidden -Command "${startCommand}"`;
}

function powershell(script) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
}

// Starts the server without connecting its output to ours: the server would inherit our pipes,
// and spawnSync would then wait for them to close, i.e. until the server stops.
function launch(startCommand) {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', startCommand], { stdio: 'ignore' });
}

async function isRunning(env) {
  const host = envValue(env, 'HOST') || '127.0.0.1';
  const port = envValue(env, 'PORT') || '3000';
  try {
    const res = await fetch(`http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function stopRunning(env) {
  const port = Number(envValue(env, 'PORT') || 3000);
  powershell(`Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
  for (let i = 0; i < 20 && (await isRunning(env)); i++) await new Promise((r) => setTimeout(r, 250));
}

async function setupBackground(env) {
  console.log('\nStep 4 of 4: Run in the background');
  const url = `http://localhost:${envValue(env, 'PORT') || '3000'}`;
  if (process.platform !== 'win32') {
    console.log(`  Start it with "npm start", then open ${url}`);
    return;
  }
  if (!(await confirm('  Start Spending Monitor now, and automatically every time you log in to Windows?'))) {
    console.log(`  OK. Start it yourself with "npm start", then open ${url}`);
    return;
  }

  const logs = path.join(root, 'logs');
  const startCommand = buildStartCommand(root, process.execPath, Number(envValue(env, 'PORT') || 3000));
  const actionArgs = buildActionArgs(startCommand);

  // Starts 1 minute after logon: right at logon the start was sometimes cut off. The start command retries
  // by itself; Task Scheduler's own restart setting only covers the task failing to launch at all.
  const register = powershell(`
    $ErrorActionPreference = 'Stop'
    try {
      $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ${psQuote(actionArgs)}
      $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"
      $trigger.Delay = 'PT1M'
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
      Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $action -Trigger $trigger -Settings $settings -Description 'Starts the Spending Monitor web app 1 minute after logon.' -Force | Out-Null
      'task'
    } catch {
      # Fallback when scheduled tasks are blocked: a shortcut in the Startup folder.
      $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Spending Monitor.lnk'))
      $shortcut.TargetPath = 'powershell.exe'
      $shortcut.Arguments = ${psQuote(actionArgs)}
      $shortcut.WindowStyle = 7
      $shortcut.Save()
      'startup'
    }`);
  const how = register.stdout.trim();
  if (register.status !== 0 || !how) {
    console.log(`  ✗ Could not set up automatic start: ${register.stderr.trim() || 'unknown error'}`);
  } else {
    console.log(how === 'task'
      ? `  ✓ Added Windows scheduled task "${TASK_NAME}" (starts 1 minute after you log in, retries if it fails).`
      : '  ✓ Added "Spending Monitor" to your Windows Startup folder (runs at logon).');
  }

  if (await isRunning(env)) {
    console.log('  Restarting the running copy so it picks up the new settings…');
    await stopRunning(env);
  }
  launch(startCommand);
  for (let i = 0; i < 20 && !(await isRunning(env)); i++) await new Promise((r) => setTimeout(r, 500));
  if (await isRunning(env)) {
    console.log(`  ✓ Running. Open ${url}`);
    const publicUrl = envValue(env, 'PUBLIC_URL');
    if (publicUrl) console.log(`    On your phone: ${publicUrl}`);
  } else {
    console.log(`  ✗ It did not start. See ${path.join(logs, 'server-error.log')}`);
  }
}

// ---------- main ----------

async function main() {
  console.log('Spending Monitor setup');
  console.log('Passwords you type here are hidden and are only stored in the .env file on this computer.');
  let env = readEnv();
  env = await setupDatabase(env);
  env = await setupMailbox(env);
  env = await setupGoogle(env);
  await setupBackground(env);
  console.log('\nDone.');
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  main().catch((err) => {
    console.error(`\nSetup stopped: ${err.message}`);
    process.exit(1);
  });
}
