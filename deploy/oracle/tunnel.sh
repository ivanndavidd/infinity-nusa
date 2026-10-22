#!/usr/bin/env bash
# Puts nusa. on your own domain through a Cloudflare Tunnel: Cloudflare serves HTTPS and forwards to the app over an
# outbound connection, so the VM opens no ports. Run on the VM after setup.sh, with a hostname on your Cloudflare account:
#   sudo bash /opt/nusa/deploy/oracle/tunnel.sh nusa.example.com
# Asks you to approve a Cloudflare sign-in link. Safe to run again (e.g. to change the hostname).
set -euo pipefail

HOST=$(printf '%s' "${1:?usage: sudo bash tunnel.sh <hostname, e.g. nusa.example.com>}" | tr '[:upper:]' '[:lower:]')
APP=/opt/nusa
PORT=3000
NAME=nusa
CONF=/etc/cloudflared
CERT=/root/.cloudflared/cert.pem

log() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n!! %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail 'Run with sudo.'
[[ "$HOST" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || fail "\"$HOST\" is not a hostname like nusa.example.com."
[ -f "$APP/.env" ] || fail 'Run setup.sh (push.ps1) first.'
cd /

if ! command -v cloudflared >/dev/null; then
  log 'Installing cloudflared'
  install -d -m 755 /usr/share/keyrings
  curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg -o /usr/share/keyrings/cloudflare-public-v2.gpg
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-public-v2.gpg] https://pkg.cloudflare.com/cloudflared any main' \
    > /etc/apt/sources.list.d/cloudflared.list
  apt-get update -q
  apt-get install -yq cloudflared
fi

# The account certificate lets this server create the tunnel and its DNS record. It is deleted again at the end,
# since running the tunnel only needs the tunnel's own credentials.
if [ ! -f "$CERT" ]; then
  log 'Sign in to Cloudflare: open the link below and pick the domain'
  cloudflared tunnel login
fi
tunnel_id() { cloudflared tunnel list --name "$NAME" --output json | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => console.log((JSON.parse(s || "null") ?? [])[0]?.id ?? "")); // "null" when there are none
'; }
id=$(tunnel_id)
if [ -z "$id" ]; then
  log 'Creating the tunnel'
  cloudflared tunnel create "$NAME" >/dev/null
  id=$(tunnel_id)
fi
[ -n "$id" ] || fail 'Could not find the tunnel after creating it.'

install -d -m 700 "$CONF"
cloudflared tunnel token --cred-file "$CONF/$id.json" "$id"
chmod 600 "$CONF/$id.json"
cat > "$CONF/config.yml" <<EOF
tunnel: $id
credentials-file: $CONF/$id.json
ingress:
  - hostname: $HOST
    service: http://127.0.0.1:$PORT
  - service: http_status:404
EOF

log "Pointing $HOST at the tunnel"
cloudflared tunnel route dns --overwrite-dns "$id" "$HOST"

if [ -f /etc/systemd/system/cloudflared.service ]; then
  systemctl restart cloudflared
else
  cloudflared --config "$CONF/config.yml" service install
fi
rm -f "$CERT" /root/.cloudflared/"$id".json

# The app answers on one address only: the domain from now on, so the Tailscale address stops serving it.
sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=https://$HOST|" "$APP/.env"
grep -q '^PUBLIC_URL=' "$APP/.env" || echo "PUBLIC_URL=https://$HOST" >> "$APP/.env"
tailscale serve reset 2>/dev/null || true
systemctl restart nusa

log "Waiting for https://$HOST (a new domain's certificate can take a few minutes)"
for _ in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/login")" = 200 ] && break
  sleep 10
done
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$HOST/login" || true)
if [ "$code" = 200 ]; then
  log "nusa. is running at https://$HOST"
else
  log "The tunnel is set up, but https://$HOST doesn't answer yet (HTTP $code). Give Cloudflare a few more minutes."
fi
echo "    Google sign-in needs this redirect URI on the OAuth client (once): https://$HOST/auth/callback"
