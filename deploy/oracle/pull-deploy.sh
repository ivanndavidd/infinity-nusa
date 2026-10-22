#!/usr/bin/env bash
# Auto-deploy, run every minute by nusa-deploy.timer (installed by setup.sh as /usr/local/sbin/nusa-pull-deploy).
# The CI workflow moves the repository's "deploy" branch to each commit on main that passes its checks; when that
# branch points at a new commit, this downloads it and installs it with setup.sh. If it doesn't start, the previous
# commit is installed again and the broken one is skipped until a newer commit arrives.
set -euo pipefail

REPO=${NUSA_REPO:?NUSA_REPO (owner/name on GitHub) is not set}
STATE=/var/lib/nusa-deploy
mkdir -p "$STATE"
cd /

latest=$(git ls-remote "https://github.com/$REPO.git" refs/heads/deploy | cut -f1)
[ -n "$latest" ] || exit 0
current=$(cat "$STATE/deployed" 2>/dev/null || true)
[ "$latest" != "$current" ] || exit 0
[ "$latest" != "$(cat "$STATE/failed" 2>/dev/null || true)" ] || exit 0

install_commit() {
  rm -rf "$STATE/upload"
  mkdir -p "$STATE/upload/app"
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$1" | tar -xz -C "$STATE/upload/app" --strip-components=1
  bash "$STATE/upload/app/deploy/oracle/setup.sh" "$STATE/upload"
}

echo "Deploying $latest (running: ${current:-unknown})"
if install_commit "$latest"; then
  echo "$latest" > "$STATE/deployed"
  rm -f "$STATE/failed"
  echo "Deployed $latest"
else
  echo "$latest" > "$STATE/failed"
  echo "Deploying $latest failed" >&2
  if [ -n "$current" ]; then
    echo "Reinstalling $current" >&2
    install_commit "$current" || echo "Reinstalling $current failed too" >&2
  fi
  exit 1
fi
