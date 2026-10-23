# Spending Monitor

A personal web app that records your spending from BCA notification emails automatically. Nothing to type in:
every minute it checks your mailbox for new emails from `bca.co.id`, reads the amount, merchant and date,
files each transaction under a category, and saves it to PostgreSQL. The dashboard shows monthly totals,
daily spending, categories, top merchants and every transaction.

- Reads the mailbox **read-only** over IMAP (never marks emails as read, deletes or moves anything).
- Everything stays on your computer: the server listens on `127.0.0.1` only.
- Declined/failed transactions, promos, OTPs and statements are ignored, not counted.

## Setup

### 1. Turn on BCA email notifications
In **myBCA**: Settings → Notifications → Email, and enable the transaction types you want (transfer, payment,
QRIS, cardless…). Credit card transaction emails go to the email address registered for the card.
See [BCA: setting up email notifications in myBCA](https://www.bca.co.id/en/informasi/edukatips/2026/04/15/09/53/mudahnya-mengatur-notifikasi-transaksi-email-di-mybca).

### 2. Create an App Password for your mailbox (Gmail)
Gmail does not accept your normal password over IMAP. Turn on 2-Step Verification, then create an
App Password at <https://myaccount.google.com/apppasswords>. Other providers: use their IMAP host and password.

### 3. Run the setup

```bash
npm install
```

```bash
npm run setup
```

It walks through four steps and checks each one before saving it to `.env`:

1. **Your PostgreSQL admin password** (the one chosen when PostgreSQL was installed). It is used once to create a
   `spending` database and a `spending_app` login with its own random password. The admin password is not saved.
2. **Your email address and App Password.** It signs in and tells you how many BCA emails it can see.
   If there are none in the inbox but some in Gmail's All Mail, it uses All Mail instead.
3. **Sign in with Google** (optional, needed for phone access). It shows you how to create a Google OAuth
   client, checks the Client ID and secret with Google, and lets in only the Google account you name.
4. **Whether to start the app now and every time you log in to Windows.** If yes, it runs in the background
   with no window, logging to `logs\`. If it's already running, it is restarted with the new settings.

Then open <http://127.0.0.1:3000>. The first sync imports the last 90 days of BCA emails (`INITIAL_SYNC_DAYS`).
Run `npm run setup` again any time to change these settings.

<details>
<summary>Manual setup instead</summary>

Create a database (`CREATE DATABASE spending;`), copy `.env.example` to `.env`, fill in `DATABASE_URL`,
`IMAP_USER` and `IMAP_PASSWORD`, then run `npm start`. Tables are created automatically on first start.
</details>

## Using it

- **Change a category**: pick one in the transaction's Category menu. You'll be asked whether to apply it to
  every transaction from that merchant; if yes, it's remembered for future emails too.
- **Hide** a transaction (e.g. a transfer between your own accounts) to leave it out of the totals.
  Credit card / PayLater **bill payments** made from myBCA start hidden, because each card purchase is already
  counted from its own card notification. Unhide one if you don't receive card notifications.
- **Emails tab**: every BCA email the app has seen. *Needs attention* means it couldn't find an amount.
  Open one to see the text the app read. BCA formats vary, so if a kind of email keeps landing there,
  share that text (remove account numbers first) and the parser in `src/parser/` can be taught the format;
  then press **Re-read all emails** to apply it to everything already stored.
- **Forecast tab**: next month's expected spending per category, from a weighted average of the last three
  complete months, plus the payments that recur every month. With `DEEPSEEK_API_KEY` in `.env`, DeepSeek refines the
  forecast, explains it, and suggests lifestyle changes. It runs once a month on its own (or on **Refresh forecast**)
  and the answer is stored. A run is roughly 3k tokens in and 10k out (thinking included), about US$0.01.
  The tab also gives a **daily limit** for next month (your budget, or else the forecast, minus recurring payments,
  split into weekdays and weekends from your own pattern), and once a month is over, **forecast vs actual** shows
  whether the statistics or the AI came closer.

## Keeping it running

The app only records emails while it is running; emails that arrive while it is off are picked up on the next
start. If you said yes to automatic start, setup added a Windows scheduled task named **Spending Monitor**
(or, if scheduled tasks are blocked on this PC, a shortcut in your Startup folder). The task starts the app
1 minute after you log in and, if it doesn't come up, tries again every minute up to 3 times. Signing out of
Windows stops the app until your next login.

- **Stop it:** in PowerShell,
  `Get-NetTCPConnection -LocalPort 3000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess }`
- **Turn off automatic start:** `Unregister-ScheduledTask -TaskName 'Spending Monitor'`
  (or delete the shortcut from the folder that opens with `shell:startup`).
- **Problems?** Look in `logs\server-error.log`, or the status line at the top of the dashboard.

## Phone access

Google sign-in only works on `localhost` or an `https://` address, so your phone needs an HTTPS link to this PC.
The simplest private option is [Tailscale](https://tailscale.com) (free for personal use):

1. Install Tailscale on this PC and on your phone, and sign in to both with the same account.
2. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS Certificates**.
3. On this PC run:

   ```bash
   tailscale serve --bg 3000
   ```

   It prints an address like `https://my-pc.tail1234.ts.net`. Only devices signed in to your Tailscale
   account can open it; it is not on the public internet.
4. Run `npm run setup` again, keep the earlier steps, and enter that address as the phone address. Add
   `https://my-pc.tail1234.ts.net/auth/callback` to the OAuth client's redirect URIs in Google Cloud.

The PC has to be on (and the app running) for the phone to reach it. This PC is a company-managed laptop:
check your IT policy before installing tunnelling software such as Tailscale on it.

## Security notes

- `.env` holds your passwords and is git-ignored. Never commit or share it.
- Keep `HOST=127.0.0.1`; reach it from other devices through `PUBLIC_URL` (see Phone access) instead.
  The app refuses to start with `PUBLIC_URL` or a non-local `HOST` unless Google sign-in is configured.
- With Google sign-in on, only the addresses in `ALLOWED_EMAILS` get in. Sessions last 30 days; removing an
  address from `ALLOWED_EMAILS` (and restarting) locks it out immediately.
- `REQUIRE_DKIM=true` drops emails whose BCA signature didn't verify, so a spoofed "BCA" email can't add fake
  transactions (works with Gmail, which records the DKIM result).
- The AI forecast sends DeepSeek monthly totals per category, merchant names and your budgets; never account or
  card numbers, email text or individual transactions. Leave `DEEPSEEK_API_KEY` empty to keep everything local.

## Development

```bash
npm test
```

| Path | Purpose |
|---|---|
| `src/server.js` | Express API + static dashboard |
| `src/auth.js` | Sign in with Google (OIDC + PKCE), sessions, access check |
| `src/mail-sync.js` | IMAP polling, sender/DKIM checks |
| `src/parser/` | BCA email → transaction (amount, merchant, date, channel, direction) |
| `src/categorize.js` | Keyword rules for categories (your own rules override them) |
| `src/db.js` | PostgreSQL schema and queries |
| `public/` | Dashboard (plain HTML/CSS/JS) |
| `scripts/setup.js` | Interactive first-time setup (`npm run setup`) |
