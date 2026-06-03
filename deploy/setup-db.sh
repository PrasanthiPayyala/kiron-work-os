#!/usr/bin/env bash
# Create the production Postgres role + database for Kiron on the same VM.
# Run as a user with sudo. Idempotent: skips role/db that already exist.
#
# Usage:  sudo bash deploy/setup-db.sh '<db_password>'
set -euo pipefail

DB_NAME="kiron"
DB_USER="kiron"
DB_PASS="${1:-}"

if [[ -z "$DB_PASS" ]]; then
  echo "Usage: sudo bash deploy/setup-db.sh '<db_password>'" >&2
  exit 1
fi

echo "==> Ensuring role '$DB_USER' exists"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';"

# Always (re)set the password so it matches backend.env even on re-runs.
sudo -u postgres psql -c "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS';"

echo "==> Ensuring database '$DB_NAME' exists"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "==> Granting privileges"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo "Done. DATABASE_URL=postgresql+psycopg://$DB_USER:<password>@localhost:5432/$DB_NAME"
