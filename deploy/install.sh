#!/usr/bin/env bash
# One-time server setup for SeatSmart on Ubuntu 24.04. Run as root:  bash deploy/install.sh
set -euo pipefail
apt-get update && apt-get -y upgrade
apt-get install -y curl git sqlite3 build-essential ufw rclone
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh
apt-get install -y nodejs
id seatsmart >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin seatsmart
mkdir -p /var/lib/seatsmart /var/backups/seatsmart
[ -d /opt/seatsmart/.git ] || git clone https://github.com/PlatePrep/seatsmart.git /opt/seatsmart
chown -R seatsmart:seatsmart /opt/seatsmart /var/lib/seatsmart /var/backups/seatsmart
cd /opt/seatsmart && sudo -u seatsmart npm ci && sudo -u seatsmart npm run build
cp deploy/seatsmart.service /etc/systemd/system/seatsmart.service
install -m 755 deploy/update.sh /usr/local/bin/seatsmart-update
install -m 755 deploy/backup.sh /usr/local/bin/seatsmart-backup
echo "15 3 * * * root /usr/local/bin/seatsmart-backup >> /var/log/seatsmart-backup.log 2>&1" > /etc/cron.d/seatsmart-backup
ufw allow OpenSSH && ufw --force enable
systemctl daemon-reload && systemctl enable seatsmart
echo "Done. Copy data.db to /var/lib/seatsmart/data.db (owner seatsmart), then: systemctl start seatsmart"
