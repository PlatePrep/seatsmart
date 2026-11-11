#!/usr/bin/env bash
# Safe copy of the live database. Keeps 30 days on the server; also uploads to Cloudflare R2 if rclone remote "r2" is set up.
set -euo pipefail
DB=/var/lib/seatsmart/data.db; DIR=/var/backups/seatsmart; F="$DIR/seatsmart-$(date +%Y%m%d-%H%M).db"
sqlite3 "$DB" ".backup '$F'" && gzip -f "$F"
find "$DIR" -name 'seatsmart-*.db.gz' -mtime +30 -delete
if rclone listremotes 2>/dev/null | grep -q '^r2:'; then rclone copy "$F.gz" r2:seatsmart-backups/ && echo "Uploaded $F.gz to R2"; fi
