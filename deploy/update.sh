#!/usr/bin/env bash
# Pull the latest SeatSmart code, rebuild and restart. Run as root:  seatsmart-update
set -euo pipefail
/usr/local/bin/seatsmart-backup
cd /opt/seatsmart
sudo -u seatsmart git pull --ff-only
sudo -u seatsmart npm ci
sudo -u seatsmart npm run build
systemctl restart seatsmart
sleep 3 && curl -fsS -o /dev/null http://127.0.0.1:5000/ && echo "SeatSmart updated and running."
