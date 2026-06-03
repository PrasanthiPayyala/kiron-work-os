#!/usr/bin/env bash
# Provision the Kiron FastAPI backend on the VM: venv, deps, migrations, seed.
# Run from the repo root (e.g. /opt/kiron) as the `kiron` user (or with sudo -u
# kiron). Assumes /etc/kiron/backend.env already exists (see DEPLOY.md).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/backend"

if [[ ! -f /etc/kiron/backend.env ]]; then
  echo "Missing /etc/kiron/backend.env — copy deploy/backend.env.example and fill it in first." >&2
  exit 1
fi

echo "==> Python venv + dependencies"
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install -r requirements.txt

# Load DATABASE_URL etc. so create_db / alembic / seed use production settings.
set -a; source /etc/kiron/backend.env; set +a

echo "==> Creating database if needed"
./.venv/bin/python -m app.create_db

echo "==> Running migrations"
./.venv/bin/alembic upgrade head

echo "==> Seeding demo/base accounts (idempotent)"
./.venv/bin/python -m app.seed

echo "Backend ready. Start it with: sudo systemctl enable --now kiron-api"
