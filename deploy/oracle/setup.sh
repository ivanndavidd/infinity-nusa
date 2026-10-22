#!/usr/bin/env bash
# Installs or updates nusa. on an Ubuntu 24.04 VM (Oracle Cloud Always Free). push.ps1 uploads the app and runs
#   sudo bash setup.sh <upload dir>
# The upload dir holds app/ (the code) and, on the first deploy, .env and spending.dump from the PC.
# Safe to run again: later runs update the code and restart, keeping the server's .env and database.
set -euo pipefail

UPLOAD=${1:?usage: sudo bash setup.sh <upload dir>}
APP=/opt/nusa
DB=spending
USER_NAME=nusa
PORT=3000

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail 'Run with sudo.'
[ -d "$UPLOAD/app/src" ] || fail "No app found in $UPLOAD/app."
cd /

log 'Installing PostgreSQL, Node.js 22 and Tailscale'
export DEBIAN_FRONTEND=noninteractive
# A new VM updates itself in the background for its first minutes; wait for apt instead of failing (also for the
# Tailscale installer's own apt-get).
echo 'DPkg::Lock::Timeout "900";' > /etc/apt/apt.conf.d/90nusa-wait-for-lock
apt-get update -q
# cron (daily backup), procps and nano aren't in the "Minimal" Ubuntu images; git is for the auto-deploy check.
apt-get install -yq ca-certificates curl cron git nano procps postgresql

# The 1 GB micro shape needs swap to run npm and PostgreSQL side by side.
if [ "$(free -m | awk '/^Mem:/ { print $2 }')" -lt 2000 ] && [ -z "$(swapon --show)" ]; then
  log 'Adding 2 GB of swap'
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! node --version 2>/dev/null | grep -Eq '^v(2[2-9]|[3-9][0-9])\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -yq nodejs
fi
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh

# The app runs as its own system user and signs in to PostgreSQL over the local socket as the database role of the
# same name (peer authentication), so there is no database password to keep.
id "$USER_NAME" >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin "$USER_NAME"
psql_admin() { runuser -u postgres -- psql -tAc "$1"; }
[ "$(psql_admin "SELECT 1 FROM pg_roles WHERE rolname = '$USER_NAME'")" = 1 ] || runuser -u postgres -- createuser "$USER_NAME"
if [ "$(psql_admin "SELECT 1 FROM pg_database WHERE datname = '$DB'")" != 1 ]; then
  log 'Creating the database'
  runuser -u postgres -- createdb -O "$USER_NAME" "$DB"
  if [ -f "$UPLOAD/spending.dump" ]; then
    log 'Restoring the data from the PC'
    if ! runuser -u "$USER_NAME" -- pg_restore --no-owner --no-privileges --exit-on-error -d "$DB" < "$UPLOAD/spending.dump"; then
      runuser -u postgres -- dropdb "$DB"
      fail 'Restoring the data failed. The new database was removed, so running this again starts clean.'
    fi
  fi
fi

log 'Installing the app'
mkdir -p "$APP"
find "$APP" -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} +
cp -r "$UPLOAD/app/." "$APP/"
(cd "$APP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
chown -R root:root "$APP"

if [ ! -f "$APP/.env" ]; then
  [ -f "$UPLOAD/.env" ] || fail 'This server has no .env yet: run push.ps1 with -Migrate the first time.'
  install -m 640 -o root -g "$USER_NAME" "$UPLOAD/.env" "$APP/.env"
  sed -i 's/\r$//' "$APP/.env"
fi
chown root:"$USER_NAME" "$APP/.env"
chmod 640 "$APP/.env"
set_env() { # replaces KEY=... in .env, or adds it
  if grep -q "^$1=" "$APP/.env"; then sed -i "s|^$1=.*|$1=$2|" "$APP/.env"; else printf '%s=%s\n' "$1" "$2" >> "$APP/.env"; fi
}
set_env HOST 127.0.0.1
set_env PORT "$PORT"
set_env DATABASE_URL "postgresql://$USER_NAME@/$DB?host=/var/run/postgresql"

# Tailscale gives the dashboard a private https://<name>.<tailnet>.ts.net address that only your devices can open.
# Once tunnel.sh has moved it to your own domain, PUBLIC_URL points there and this step leaves it alone.
url=$(sed -n 's/^PUBLIC_URL=//p' "$APP/.env")
if [ -z "$url" ] || [[ "$url" == *.ts.net ]]; then
  if ! tailscale ip -4 >/dev/null 2>&1; then
    log 'Sign in to Tailscale: open the link below and approve this server'
    tailscale up --hostname=nusa
  fi
  # On a tailnet without HTTPS certificates this prints a link to turn them on, then waits until they are.
  tailscale serve --bg "$PORT"
  url="https://$(tailscale status --json | node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => console.log(JSON.parse(s).Self.DNSName.replace(/\.$/, "")));
  ')"
  set_env PUBLIC_URL "$url"
fi

log 'Starting the service'
install -m 644 "$APP/deploy/oracle/nusa.service" /etc/systemd/system/nusa.service
install -m 755 "$APP/deploy/oracle/backup.sh" /etc/cron.daily/nusa-backup
# Auto-deploy from GitHub (pull-deploy.sh): installs each commit the CI workflow puts on the "deploy" branch.
install -m 755 "$APP/deploy/oracle/pull-deploy.sh" /usr/local/sbin/nusa-pull-deploy
install -m 644 "$APP/deploy/oracle/nusa-deploy.service" "$APP/deploy/oracle/nusa-deploy.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --quiet nusa
systemctl enable --now --quiet nusa-deploy.timer
systemctl restart nusa
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  journalctl -u nusa -n 30 --no-pager
  fail 'The app did not start; the log above says why.'
fi

rm -f "$UPLOAD/.env" "$UPLOAD/spending.dump"
log "nusa. is running at $url"
echo "    Google sign-in needs this redirect URI on the OAuth client (once): $url/auth/callback"
