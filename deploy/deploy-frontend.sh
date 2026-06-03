#!/usr/bin/env bash
# Build the PWA and publish it to the nginx web root. Run on the VM from the
# repo root after `git pull`. Requires Node 18+ installed on the VM.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_ROOT="${WEB_ROOT:-/var/www/kiron}"

cd "$REPO_ROOT"

echo "==> Installing frontend dependencies"
npm ci --legacy-peer-deps

echo "==> Building (uses .env.production → VITE_API_URL=/api)"
npm run build

echo "==> Publishing to $WEB_ROOT"
sudo mkdir -p "$WEB_ROOT"
sudo rsync -a --delete dist/ "$WEB_ROOT/"
sudo chown -R www-data:www-data "$WEB_ROOT"

echo "Frontend published. Reload nginx if config changed: sudo systemctl reload nginx"
