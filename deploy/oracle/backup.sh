#!/usr/bin/env bash
# Daily backup of the nusa. database, installed by setup.sh as /etc/cron.daily/nusa-backup. Keeps 14 days.
set -euo pipefail

dir=/var/backups/nusa
install -d -m 700 "$dir"
cd /
runuser -u postgres -- pg_dump --format=custom spending > "$dir/spending-$(date +%F).dump"
find "$dir" -name 'spending-*.dump' -mtime +14 -delete
